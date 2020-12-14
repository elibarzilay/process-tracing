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
                     type: "number" }})
    .help("h").alias("h", "help")
    .strict())
  .argv;

const instantTypes = "MIBE".split(""); // no duration => always included

async function run(fast = true) {
  console.log(fast ? "Processing..." : "  (retrying with a full parser)");
  const test = x =>
    instantTypes.includes(x.ph)
    || ((!args.sample ||
         (args.sample - x.ts % args.sample) <= x.dur
         // Math.floor(x.ts/args.sample) !== Math.floor((x.ts+x.dur)/args.sample)
        )
        && (!args.minDur || x.dur > args.minDur));
  let comma = false;
  try {
    await pipeline(
      fs.createReadStream(args.input),
      ...(/\.gz$/.test(args.input) ? [zlib.createGunzip()]
          : /\.br$/.test(args.input) ? [zlib.createBrotliDecompress()]
          : []),
      fast
        ? split(/,?\r?\n/, x => x.length > 1 && test(JSON.parse(x)) ? x : undefined)
        : jsonstream.parse("*", x => test(x) ? JSON.stringify(x) : undefined),
      async function* (inp) {
        for await (const x of inp) { yield (comma ? ",\n" : "[\n") + x; comma = true; }
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
