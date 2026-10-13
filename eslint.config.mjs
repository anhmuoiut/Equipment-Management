import nextVitals from 'eslint-config-next/core-web-vitals';

export default [
  ...nextVitals,
  { ignores: ['.next/**', 'node_modules/**', 'backups/**'] },
  { rules: {
  "no-restricted-imports": [
    "error",
    {
      "patterns": [
        {
          "group": [
            "**/lib/supabase/admin",
            "@/lib/supabase/admin"
          ],
          "message": "service_role client chỉ được import trong lib/services/**, lib/auth/** và scripts/** (xem lib/supabase/admin.ts)."
        }
      ]
    }
  ]
} },
  ...[
  {
    "files": [
      "lib/services/**/*.ts",
      "lib/auth/**/*.ts",
      "scripts/**/*.ts"
    ],
    "rules": {
      "no-restricted-imports": "off"
    }
  }
],
];
