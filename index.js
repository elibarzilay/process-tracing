#!/usr/bin/env node
"use strict";

const mode = "split"; // json, split

const fs = require("fs");
const zlib = require("zlib");
const jsonstream = require("jsonstream-next");
const split = require("split2");
const yargs = require("yargs");
const { pipeline } = require("stream/promises");

const args = yargs(process.argv.slice(2))
  .command("$0 <input> <output>", "Preprocess tracing dumps", yargs => yargs
    .positional("input", { type: "string", desc: "json file to read (possibly compressed)" })
    .positional("output", { type: "string", desc: "json file to write (possibly compressed)" })
    .options({"s": { alias: "sample",
                     describe: "sample events at this frequency (msec) ",
                     type: "number" },
              "m": { alias: "min-dur",
                     describe: "filter events with this minimum duration (msec)",
                     type: "number" },
              "j": { alias: "join",
                     describe: "join B/E events to a single X event",
                     type: "boolean" },
              "c": { alias: "close",
                     describe: "close unterminated B events at the end",
                     type: "boolean" },
              "v": { alias: "verify",
                     describe: "verify B/E events have matching contents",
                     type: "boolean" }})
    .help("h").alias("h", "help")
    .strict())
  .argv;

const joinTypes = (args.join || args.close || args.verify) ? "BE".split("") : [];
const instantTypes = (joinTypes.length ? "MI" : "MIBE").split(""); // no duration => always included

async function run(fast = true) {
  console.log(fast ? "Processing..." : "  (retrying with a full parser)");
  //
  const stack = [];
  let lastTime = 0;
  const makeX = (x, until) => JSON.stringify({...x, ph: "X", dur: until - x.ts});
  const getTail =
    args.join && args.close ? () => stack.reverse().map(x => makeX(x, lastTime))
    : args.close ? () => stack.reverse().map(x => JSON.stringify({...x, ph: "E", ts: lastTime}))
    : () => stack.map(JSON.stringify);
  //
  const test = (x, str = () => JSON.stringify(x)) => {
    if (args.close) {
      const end = "dur" in x ? x.ts + x.dur : x.ts;
      if (end > lastTime) lastTime = end;
    }
    if (joinTypes.includes(x.ph)) {
      if (x.ph === "B") {
        stack.push(x);
        return !args.join ? str() : undefined;
      } else { // === "E"
        const top = stack.pop();
        if (top === undefined)
          throw Error(`Verification error: no B event for ${str()}`);
        if (args.verify) {
          if (top.cat !== x.cat)
            throw Error(`Verification error: different "cat" in ${str()}`);
          if (top.name !== x.name)
            throw Error(`Verification error: different "name" in ${str()}`);
          if (JSON.stringify(top.args) !== JSON.stringify(x.args))
            throw Error(`Verification error: different "args" in ${str()}`);
        }
        return !args.join ? str() : makeX(top, x.ts);
      }
    }
    if (instantTypes.includes(x.ph)
        || ((!args.sample ||
             (args.sample - x.ts % args.sample) <= x.dur
             // Math.floor(x.ts/args.sample) !== Math.floor((x.ts+x.dur)/args.sample)
            )
            && (!args.minDur || x.dur > args.minDur))) {
      return str();
    }
    return undefined;
  }
  //
  let comma = false;
  try {
    await pipeline(
      fs.createReadStream(args.input),
      ...(/\.gz$/.test(args.input) ? [zlib.createGunzip()]
          : /\.br$/.test(args.input) ? [zlib.createBrotliDecompress()]
          : []),
      fast
        ? split(/,?\r?\n/, x => x.length > 1 ? test(JSON.parse(x), () => x) : undefined)
        : jsonstream.parse("*", x => test(x)),
      async function* (inp) {
        const disp = x => (comma ? ",\n" : (comma = true, "[\n")) + x;
        for await (const x of inp) yield disp(x);
        for (const x of getTail()) yield disp(x);
        yield "\n]\n";
      },
      ...(/\.gz$/.test(args.output) ? [zlib.createGzip()]
          : /\.br$/.test(args.output) ? [zlib.createBrotliCompress()]
          : []),
      fs.createWriteStream(args.output)
    );
    console.log("Done.");
  } catch (e) {
    if (fast && e instanceof SyntaxError && /JSON/.test(e.message)) return run(false);
    throw e;
  }
}

run().catch(console.error);
