declare const _default: ({
    readonly rules: Readonly<import("eslint").Linter.RulesRecord>;
} | {
    files: string[];
    languageOptions: {
        parser: any;
        parserOptions: {
            project: string;
        };
        globals: {
            node: boolean;
            jest: boolean;
            console: string;
            process: string;
            module: string;
            require: string;
            __dirname: string;
            __filename: string;
            Buffer: string;
            global: string;
            setTimeout: string;
            clearTimeout: string;
            setInterval: string;
            clearInterval: string;
            NodeJS: string;
            fetch: string;
        };
    };
    plugins: {
        '@typescript-eslint': {
            configs: Record<string, tsParser>;
            meta: tsParser;
            rules: typeof import("@typescript-eslint/eslint-plugin/rules");
        };
        prettier: import("eslint").ESLint.Plugin;
    };
    rules: {
        '@typescript-eslint/no-explicit-any': string;
        '@typescript-eslint/no-unused-vars': (string | {
            argsIgnorePattern: string;
            varsIgnorePattern: string;
        })[];
        '@typescript-eslint/no-floating-promises': string;
        '@typescript-eslint/await-thenable': string;
        '@typescript-eslint/no-for-in-array': string;
        '@typescript-eslint/no-misused-promises': (string | {
            checksVoidReturn: {
                attributes: boolean;
            };
        })[];
        '@typescript-eslint/switch-exhaustiveness-check': string;
        '@typescript-eslint/consistent-type-assertions': (string | {
            assertionStyle: string;
            objectLiteralTypeAssertions: string;
        })[];
        '@typescript-eslint/explicit-function-return-type': (string | {
            allowExpressions: boolean;
            allowTypedFunctionExpressions: boolean;
            allowHigherOrderFunctions: boolean;
            allowDirectConstAssertionInArrowFunctions: boolean;
        })[];
        '@typescript-eslint/prefer-nullish-coalescing': string;
        '@typescript-eslint/prefer-optional-chain': string;
        '@typescript-eslint/consistent-type-imports': (string | {
            prefer: string;
            fixStyle: string;
        })[];
        '@typescript-eslint/no-import-type-side-effects': string;
        '@typescript-eslint/no-unnecessary-type-assertion': string;
        '@typescript-eslint/consistent-type-definitions': string[];
        '@typescript-eslint/require-await': string;
        '@typescript-eslint/return-await': string[];
        'prefer-const': string;
        'no-var': string;
        curly: string[];
        eqeqeq: (string | {
            null: string;
        })[];
        'no-eval': string;
        'object-shorthand': string[];
        'prefer-arrow-callback': string;
        'prefer-template': string;
        'no-console': (string | {
            allow: string[];
        })[];
        '@typescript-eslint/strict-boolean-expressions': string;
        '@typescript-eslint/no-unnecessary-condition': string;
        '@typescript-eslint/no-unsafe-assignment': string;
        '@typescript-eslint/no-unsafe-call': string;
        '@typescript-eslint/no-unsafe-member-access': string;
        '@typescript-eslint/no-unsafe-return': string;
        '@typescript-eslint/no-unsafe-argument': string;
        '@typescript-eslint/explicit-module-boundary-types': string;
        '@typescript-eslint/prefer-readonly': string;
        '@typescript-eslint/member-ordering': string;
        '@typescript-eslint/no-shadow': string;
        '@typescript-eslint/promise-function-async': string;
        '@typescript-eslint/only-throw-error': string;
        '@typescript-eslint/interface-name-prefix': string;
        '@typescript-eslint/naming-convention': (string | {
            selector: string;
            format: string[];
        })[];
        complexity: (string | number)[];
        'max-depth': (string | number)[];
        'max-lines-per-function': (string | {
            max: number;
            skipBlankLines: boolean;
            skipComments: boolean;
        })[];
        'max-params': (string | {
            max: number;
        })[];
        'max-lines': (string | {
            max: number;
            skipBlankLines: boolean;
            skipComments: boolean;
        })[];
        'no-magic-numbers': string;
        'sort-imports': string;
        'prefer-destructuring': (string | {
            array: boolean;
            object: boolean;
            enforceForRenamedProperties?: undefined;
        } | {
            enforceForRenamedProperties: boolean;
            array?: undefined;
            object?: undefined;
        })[];
        'no-param-reassign': (string | {
            props: boolean;
        })[];
        'no-nested-ternary': string;
        'no-else-return': string;
        'consistent-return': string;
        'no-unused-expressions': string;
        'max-nested-callbacks': (string | number)[];
        'max-statements-per-line': string;
        'require-atomic-updates': string;
        'prefer-promise-reject-errors': string;
        'no-unneeded-ternary': string;
        radix: string;
        'no-return-await': string;
        '@typescript-eslint/no-inferrable-types': string;
        '@typescript-eslint/no-unnecessary-type-arguments': string;
        '@typescript-eslint/no-unnecessary-qualifier': string;
        '@typescript-eslint/prefer-reduce-type-parameter': string;
        '@typescript-eslint/prefer-return-this-type': string;
        '@typescript-eslint/prefer-string-starts-ends-with': string;
        '@typescript-eslint/prefer-includes': string;
        '@typescript-eslint/no-implied-eval': string;
        '@typescript-eslint/unified-signatures': string;
        '@typescript-eslint/array-type': string;
        '@typescript-eslint/no-non-null-asserted-optional-chain': string;
        '@typescript-eslint/no-unnecessary-boolean-literal-compare': string;
        '@typescript-eslint/no-confusing-void-expression': string;
        'prettier/prettier': (string | {
            usePrettierrc?: undefined;
        } | {
            usePrettierrc: boolean;
        })[];
    };
    ignores?: undefined;
} | {
    ignores: string[];
    files?: undefined;
    languageOptions?: undefined;
    plugins?: undefined;
    rules?: undefined;
})[];
export default _default;
//# sourceMappingURL=eslint.config.d.ts.map