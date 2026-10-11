import { register } from "node:module";

register("./resolver.mjs", {
  parentURL: import.meta.url,
});
