export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['web', 'jobs', 'core', 'crawler', 'db', 'contracts', 'ci', 'docs', 'deps', 'repo'],
    ],
    'subject-case': [0],
  },
};
