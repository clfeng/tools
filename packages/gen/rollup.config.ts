import { defineConfig } from 'rollup';
import typescript from 'rollup-plugin-typescript2';

export default defineConfig({
  input: 'src/index.ts',
	output: {
    dir: "dist",
		format: 'cjs'
	},
  plugins: [
    typescript()
  ],
  watch: {
    include: ["./src/**"]
  }
});