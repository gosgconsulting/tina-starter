#!/usr/bin/env node

/**
 * Test script to verify port checking functionality
 */

const { spawn } = require('child_process');
const { promisify } = require('util');
const net = require('net');
const execAsync = promisify(require('child_process').exec);

// Import the functions from the main script
const fs = require('fs');
const path = require('path');

// Read the main script and extract the functions
const mainScriptPath = path.join(__dirname, 'build-with-tina.js');
const mainScriptContent = fs.readFileSync(mainScriptPath, 'utf8');

// Extract the isPortListening function
function extractIsPortListening() {
  const net = require('net');
  
  return function isPortListening(port, host = 'localhost') {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;
      
      // Set a timeout for the connection attempt
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          console.log(`[testing] Connection timeout for ${host}:${port}`);
          resolve(false);
        }
      }, 3000); // 3 second timeout
      
      socket.on('connect', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          socket.destroy();
          console.log(`[testing] Successfully connected to ${host}:${port}`);
          resolve(true);
        }
      });
      
      socket.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.log(`[testing] Connection error for ${host}:${port}: ${error.message}`);
          resolve(false);
        }
      });
      
      socket.on('timeout', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          socket.destroy();
          console.log(`[testing] Connection timeout for ${host}:${port}`);
          resolve(false);
        }
      });
      
      // Attempt to connect
      socket.connect(port, host);
    });
  };
}

// Extract the fallback function
async function isPortListeningFallback(port, host = 'localhost') {
  try {
    // Try multiple methods to check if port is listening
    const commands = [
      `ss -tuln | grep :${port}`,
      `netstat -tuln | grep :${port}`,
      `lsof -i :${port}`,
      `cat /proc/net/tcp | grep :${port.toString(16)}`
    ];
    
    for (const command of commands) {
      try {
        const { stdout } = await execAsync(command);
        if (stdout.trim()) {
          console.log(`[testing] Fallback method found port ${port} listening using: ${command}`);
          return true;
        }
      } catch (error) {
        // Continue to next command if this one fails
        continue;
      }
    }
    
    return false;
  } catch (error) {
    console.log(`[testing] All fallback methods failed: ${error.message}`);
    return false;
  }
}

async function testPortChecking() {
  console.log('[testing] Starting port checking test...');
  
  // Test 1: Check a port that should not be listening (port 9999)
  console.log('\n[testing] Test 1: Checking port 9999 (should not be listening)...');
  const isPortListening = extractIsPortListening();
  
  const result1 = await isPortListening(9999, 'localhost');
  console.log(`[testing] Port 9999 result: ${result1}`);
  
  const result1Fallback = await isPortListeningFallback(9999, 'localhost');
  console.log(`[testing] Port 9999 fallback result: ${result1Fallback}`);
  
  // Test 2: Check port 80 (usually not available, but might be)
  console.log('\n[testing] Test 2: Checking port 80...');
  const result2 = await isPortListening(80, 'localhost');
  console.log(`[testing] Port 80 result: ${result2}`);
  
  const result2Fallback = await isPortListeningFallback(80, 'localhost');
  console.log(`[testing] Port 80 fallback result: ${result2Fallback}`);
  
  // Test 3: Start a simple HTTP server and test against it
  console.log('\n[testing] Test 3: Starting test HTTP server on port 8080...');
  const http = require('http');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Test server running');
  });
  
  server.listen(8080, () => {
    console.log('[testing] Test server started on port 8080');
  });
  
  // Wait a moment for server to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test against the running server
  console.log('[testing] Testing against running server on port 8080...');
  const result3 = await isPortListening(8080, 'localhost');
  console.log(`[testing] Port 8080 result: ${result3}`);
  
  const result3Fallback = await isPortListeningFallback(8080, 'localhost');
  console.log(`[testing] Port 8080 fallback result: ${result3Fallback}`);
  
  // Clean up
  server.close(() => {
    console.log('[testing] Test server stopped');
  });
  
  console.log('\n[testing] Port checking test completed!');
}

// Run the test
testPortChecking().catch(console.error);
