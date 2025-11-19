import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
	{
		ignores: ['dist', 'node_modules', 'coverage'],
	},
	{
		files: ['**/*.js'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		rules: {
			...js.configs.recommended.rules,
			'no-unused-vars': [
				'warn',
				{ vars: 'all', args: 'after-used', ignoreRestSiblings: true },
			],
			'no-console': 'warn',
			'no-var': 'error',
			'prefer-const': 'error',
			'prefer-arrow-callback': 'warn',
			eqeqeq: ['error', 'always'],
			curly: ['error', 'all'],
			'no-multi-spaces': 'error',
			'spaced-comment': ['warn', 'always'],
			semi: ['error', 'always'],
			quotes: ['error', 'single', { avoidEscape: true }],
			indent: ['error', 'tab', { SwitchCase: 1 }],
			'no-trailing-spaces': 'warn',
			'eol-last': ['warn', 'always'],
		},
	},
	prettier,
];
