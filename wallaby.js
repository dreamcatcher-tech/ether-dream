export default function () {
  return {
    files: [
      'package.json',
      'src/**/*.js',
      'test/**/*.js',
      { pattern: 'test/**/*.test.js', ignore: true },
    ],
    tests: ['test/multi/**/*.test.js'],
    env: {
      type: 'node',
      runner: 'node',
      params: {
        env: 'MODEL=1',
        runner: '--experimental-vm-modules',
      },
    },
    testFramework: 'mocha',
    workers: { restart: true },
  }
}
