# Process TypeScript tracing files

Post-processing script for TypeScript's experimental `generateTrace`
files.

## Quick Usage

```sh
npm i -g process-tracing
process-tracing [options] input-file output-file
```

Use `--help` for all options.


## Additional Verbiage

TypeScript recently introduced `generateTrace` to generate trace files
that are useful in [debugging the typechecker's
performance](https://github.com/microsoft/TypeScript/wiki/Performance-Tracing).
These files can become pretty big in long compilations, to a point where
they cannot be loaded into `about://tracing`.

The thing to keep in mind is that trace files are *complete* — all
events are included, rather than performing a periodic statistical
sampling.  This script's main use is to mimic such statistical sampling
by filtering out events.  For example, down-sample a tracing file at a
5ms frequency:

```sh
process-tracing --sample=5 trace.1.json sampled-output.json
```

(Note that this is still not equivalent to statistical sampling, since
the complete tracing in itself introduces additional overhead.)

The script has a few additional useful features:

* Input/output files can be gzipped (or brotli-zipped) based on the file
  name.  (`about://tracing`, as well as other profiling tools, will
  happily accept a `.json.gz` file.)

* It can "close-off" unterminated events, in case of a partial trace
  file due to a compiler crash.

* Instead of periodic sampling, it can also drop events below a given
  threshold.
