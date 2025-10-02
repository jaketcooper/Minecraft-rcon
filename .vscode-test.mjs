import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	version: 'stable',
	mocha: {
		timeout: 20000
	}
});
