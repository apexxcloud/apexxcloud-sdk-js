import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import terser from "@rollup/plugin-terser";

export default {
  input: "src/sdk.js",
  output: [
    {
      file: "dist/sdk.js",
      format: "umd",
      name: "ApexxCloudSDK",
      sourcemap: true,
    },
    {
      file: "dist/sdk.mjs",
      format: "es",
      sourcemap: true,
    },
    {
      file: "dist/sdk.min.js",
      format: "umd",
      name: "ApexxCloudSDK",
      plugins: [terser()],
      sourcemap: true,
    },
  ],
  plugins: [
    resolve(),
    commonjs(),
    babel({
      babelHelpers: "bundled",
      exclude: "node_modules/**",
    }),
  ],
};
