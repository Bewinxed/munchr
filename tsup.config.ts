import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'backends/index': 'src/backends/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: true,
  treeshake: true,
  external: [
    '@standard-schema/spec',
    'ai',
    'html-to-text',
    'unpdf',
    'papaparse',
    'exceljs',
    'mammoth',
    'mailparser',
    'valibot',
    'zod',
  ],
});
