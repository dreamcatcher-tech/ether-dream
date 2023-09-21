export default function () {
  return {
    files: [
      'package.json',
      'src/**/*.js',
      'test/**/*.js',
      { pattern: 'test/**/*.test.js', ignore: true },
    ],
    tests: ['test/multi/**/*.test.js'],
    env: { type: 'node', runner: 'node' },
    testFramework: 'mocha',
    workers: { restart: true },
  }
}
