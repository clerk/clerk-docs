module.exports = {
	"env": {
		"browser": true,
		"es2021": true
	},
	"extends": ["eslint:recommended", "plugin:mdx/recommended"],
	"overrides": [
		{
			"env": {
				"node": true
			},
			"files": [
				".eslintrc.{js,cjs}"
			],
			"parserOptions": {
				"sourceType": "script"
			}
		}
	],
	"parserOptions": {
		"ecmaVersion": "latest"
	},
	"rules": {
		"indent": [
			"off",
			"tab"
		],
		"linebreak-style": [
			"off",
			"unix"
		],
		"quotes": [
			"error",
			"double"
		],
		"semi": [
			"error",
			"always"
		]
	}
};
