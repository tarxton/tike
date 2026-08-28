export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['web', 'jobs', 'core', 'crawler', 'db', 'contracts', 'ci', 'docs', 'deps', 'repo'],
    ],
    'subject-case': [0],
    // Keep history scannable: short subjects, and a body only when it earns its place.
    // Durable reasoning belongs in docs/adr/, not in the commit message.
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [2, 'always', 100],
  },
};
