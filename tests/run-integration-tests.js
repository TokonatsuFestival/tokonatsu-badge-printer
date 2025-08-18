#!/usr/bin/env node

/**
 * Integration Test Runner
 * 
 * This script runs comprehensive integration tests for the Festival Badge Printer system.
 * It includes tests for complete workflow, concurrent users, printer failure recovery,
 * performance optimization, and template compatibility.
 */

const { spawn } = require('child_process');
const path = require('path');

const testSuites = [
  {
    name: 'Complete Workflow Integration',
    file: 'integration-complete-workflow.test.js',
    description: 'Tests end-to-end badge creation workflow'
  },
  {
    name: 'Concurrent Users',
    file: 'concurrent-users.test.js',
    description: 'Tests multiple simultaneous users and queue management'
  },
  {
    name: 'Printer Failure Recovery',
    file: 'printer-failure-recovery.test.js',
    description: 'Tests printer disconnection and reconnection scenarios'
  },
  {
    name: 'Performance Optimization',
    file: 'performance-optimization.test.js',
    description: 'Tests response times and system performance'
  },
  {
    name: 'Template Compatibility',
    file: 'template-compatibility.test.js',
    description: 'Tests template loading and badge generation'
  }
];

async function runTest(testSuite) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: ${testSuite.name}`);
    console.log(`Description: ${testSuite.description}`);
    console.log(`File: ${testSuite.file}`);
    console.log(`${'='.repeat(60)}\n`);

    const testProcess = spawn('npm', ['test', '--', `tests/${testSuite.file}`, '--verbose'], {
      stdio: 'inherit',
      shell: true
    });

    testProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✅ ${testSuite.name} - PASSED\n`);
        resolve({ name: testSuite.name, status: 'PASSED', code });
      } else {
        console.log(`\n❌ ${testSuite.name} - FAILED (exit code: ${code})\n`);
        resolve({ name: testSuite.name, status: 'FAILED', code });
      }
    });

    testProcess.on('error', (error) => {
      console.error(`\n❌ ${testSuite.name} - ERROR: ${error.message}\n`);
      resolve({ name: testSuite.name, status: 'ERROR', error: error.message });
    });
  });
}

async function runAllTests() {
  console.log('🚀 Starting Festival Badge Printer Integration Tests');
  console.log(`📅 Started at: ${new Date().toISOString()}`);
  console.log(`📁 Working directory: ${process.cwd()}`);
  console.log(`🧪 Total test suites: ${testSuites.length}\n`);

  const startTime = Date.now();
  const results = [];

  // Run tests sequentially to avoid conflicts
  for (const testSuite of testSuites) {
    const result = await runTest(testSuite);
    results.push(result);
    
    // Add delay between test suites to ensure clean state
    if (testSuite !== testSuites[testSuites.length - 1]) {
      console.log('⏳ Waiting 3 seconds before next test suite...\n');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  const endTime = Date.now();
  const totalTime = endTime - startTime;

  // Generate summary report
  console.log('\n' + '='.repeat(80));
  console.log('📊 INTEGRATION TEST SUMMARY REPORT');
  console.log('='.repeat(80));
  console.log(`📅 Completed at: ${new Date().toISOString()}`);
  console.log(`⏱️  Total execution time: ${(totalTime / 1000).toFixed(2)} seconds`);
  console.log(`🧪 Total test suites: ${results.length}`);

  const passed = results.filter(r => r.status === 'PASSED').length;
  const failed = results.filter(r => r.status === 'FAILED').length;
  const errors = results.filter(r => r.status === 'ERROR').length;

  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`🚨 Errors: ${errors}`);
  console.log(`📈 Success rate: ${((passed / results.length) * 100).toFixed(1)}%`);

  console.log('\n📋 Detailed Results:');
  results.forEach((result, index) => {
    const status = result.status === 'PASSED' ? '✅' : 
                   result.status === 'FAILED' ? '❌' : '🚨';
    console.log(`  ${index + 1}. ${status} ${result.name}`);
    if (result.code !== undefined && result.code !== 0) {
      console.log(`     Exit code: ${result.code}`);
    }
    if (result.error) {
      console.log(`     Error: ${result.error}`);
    }
  });

  console.log('\n' + '='.repeat(80));

  if (failed > 0 || errors > 0) {
    console.log('❌ Some tests failed. Please review the output above for details.');
    console.log('💡 Tips for troubleshooting:');
    console.log('   - Check if the server is running properly');
    console.log('   - Verify printer connections and drivers');
    console.log('   - Ensure templates are properly configured');
    console.log('   - Check system resources (memory, disk space)');
    console.log('   - Review application logs in the logs/ directory');
    process.exit(1);
  } else {
    console.log('🎉 All integration tests passed successfully!');
    console.log('✨ The Festival Badge Printer system is ready for deployment.');
    process.exit(0);
  }
}

// Handle script interruption
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Integration tests interrupted by user');
  console.log('🛑 Exiting...');
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.log('\n\n⚠️  Integration tests terminated');
  console.log('🛑 Exiting...');
  process.exit(143);
});

// Run the tests
runAllTests().catch((error) => {
  console.error('\n🚨 Fatal error running integration tests:', error);
  process.exit(1);
});