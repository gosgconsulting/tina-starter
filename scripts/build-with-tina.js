#!/usr/bin/env node

/**
 * Docker-friendly build script for TinaCMS
 * This script starts the TinaCMS dev server, waits for it to be ready,
 * builds the Next.js app, and then properly shuts down the TinaCMS server.
 */

const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const net = require('net');

const execAsync = promisify(exec);

// Configuration
const TINA_PORT = 4001;
const TINA_HOST = 'localhost';
const MAX_WAIT_TIME = 60000; // 60 seconds
const CHECK_INTERVAL = 2000; // 2 seconds

/**
 * Check if a port is actually accepting connections
 * @param {number} port - Port to check
 * @param {string} host - Host to check
 * @returns {Promise<boolean>} - True if port is accepting connections
 */
async function isPortListening(port, host = 'localhost') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    
    // Set a timeout for the connection attempt
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log(`[tina-docker] Connection timeout for ${host}:${port}`);
        resolve(false);
      }
    }, 3000); // 3 second timeout
    
    socket.on('connect', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        socket.destroy();
        console.log(`[tina-docker] Successfully connected to ${host}:${port}`);
        resolve(true);
      }
    });
    
    socket.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        console.log(`[tina-docker] Connection error for ${host}:${port}: ${error.message}`);
        resolve(false);
      }
    });
    
    socket.on('timeout', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        socket.destroy();
        console.log(`[tina-docker] Connection timeout for ${host}:${port}`);
        resolve(false);
      }
    });
    
    // Attempt to connect
    socket.connect(port, host);
  });
}

/**
 * Fallback method to check if a port is listening using system commands
 * @param {number} port - Port to check
 * @param {string} host - Host to check
 * @returns {Promise<boolean>} - True if port is listening
 */
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
          console.log(`[tina-docker] Fallback method found port ${port} listening using: ${command}`);
          return true;
        }
      } catch (error) {
        // Continue to next command if this one fails
        continue;
      }
    }
    
    return false;
  } catch (error) {
    console.log(`[tina-docker] All fallback methods failed: ${error.message}`);
    return false;
  }
}

/**
 * Wait for TinaCMS server to be ready
 * @param {number} maxWaitTime - Maximum time to wait in milliseconds
 * @returns {Promise<void>}
 */
async function waitForTinaServer(maxWaitTime = MAX_WAIT_TIME) {
  console.log('[tina-docker] Waiting for TinaCMS server to be ready...');
  
  const startTime = Date.now();
  let attempts = 0;
  
  while (Date.now() - startTime < maxWaitTime) {
    attempts++;
    console.log(`[tina-docker] Attempt ${attempts}: Checking if TinaCMS server is ready on ${TINA_HOST}:${TINA_PORT}...`);
    
    try {
      // Try the primary method (socket connection)
      const isReady = await isPortListening(TINA_PORT, TINA_HOST);
      if (isReady) {
        console.log(`[tina-docker] ✅ TinaCMS server is ready on port ${TINA_PORT} after ${attempts} attempts`);
        return;
      }
      
      // If primary method fails, try fallback method
      console.log(`[tina-docker] Primary method failed, trying fallback method...`);
      const isReadyFallback = await isPortListeningFallback(TINA_PORT, TINA_HOST);
      if (isReadyFallback) {
        console.log(`[tina-docker] ✅ TinaCMS server is ready on port ${TINA_PORT} (fallback method) after ${attempts} attempts`);
        return;
      }
      
    } catch (error) {
      console.log(`[tina-docker] Error checking port: ${error.message}`);
    }
    
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const remaining = Math.round((maxWaitTime - (Date.now() - startTime)) / 1000);
    console.log(`[tina-docker] TinaCMS server not ready yet, waiting... (${elapsed}s elapsed, ${remaining}s remaining)`);
    await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
  }
  
  throw new Error(`TinaCMS server failed to start within ${maxWaitTime / 1000} seconds after ${attempts} attempts`);
}

/**
 * Kill process by name
 * @param {string} processName - Name of the process to kill
 * @returns {Promise<void>}
 */
async function killProcess(processName) {
  try {
    console.log(`[tina-docker] Attempting to kill ${processName} processes...`);
    
    // Try different methods to kill the process
    const commands = [
      `pkill -f '${processName}'`,
      `pgrep -f '${processName}' | xargs kill -9`,
      `ps aux | grep '${processName}' | grep -v grep | awk '{print $2}' | xargs kill -9`
    ];
    
    for (const command of commands) {
      try {
        await execAsync(command);
        console.log(`[tina-docker] Successfully killed ${processName} processes using: ${command}`);
        return;
      } catch (error) {
        // Continue to next command if this one fails
        continue;
      }
    }
    
    console.log(`[tina-docker] No ${processName} processes found or already killed`);
  } catch (error) {
    console.log(`[tina-docker] Warning: Could not kill ${processName} processes:`, error.message);
  }
}

/**
 * Main build function
 */
async function main() {
  let tinaProcess = null;
  
  try {
    console.log('[tina-docker] Starting TinaCMS build process...');
    
    // Kill any existing TinaCMS processes
    await killProcess('tinacms dev');
    
    // Start TinaCMS dev server
    console.log('[tina-docker] Starting TinaCMS dev server...');
    tinaProcess = spawn('npx', ['tinacms', 'dev', '--port', TINA_PORT.toString(), '--noTelemetry'], {
      stdio: 'pipe',
      detached: false
    });
    
    // Log TinaCMS output
    tinaProcess.stdout.on('data', (data) => {
      console.log(`[tina-docker] TinaCMS: ${data.toString().trim()}`);
    });
    
    tinaProcess.stderr.on('data', (data) => {
      console.log(`[tina-docker] TinaCMS Error: ${data.toString().trim()}`);
    });
    
    // Wait for TinaCMS server to be ready
    await waitForTinaServer();
    
    // Build Next.js app
    console.log('[tina-docker] Building Next.js app...');
    const buildProcess = spawn('npx', ['next', 'build'], {
      stdio: 'inherit',
      detached: false
    });
    
    await new Promise((resolve, reject) => {
      buildProcess.on('close', (code) => {
        if (code === 0) {
          console.log('[tina-docker] Next.js build completed successfully');
          resolve();
        } else {
          reject(new Error(`Next.js build failed with code ${code}`));
        }
      });
    });
    
    console.log('[tina-docker] Build process completed successfully');
    
  } catch (error) {
    console.error('[tina-docker] Build process failed:', error.message);
    process.exit(1);
  } finally {
    // Clean up: kill TinaCMS process
    if (tinaProcess) {
      console.log('[tina-docker] Shutting down TinaCMS server...');
      tinaProcess.kill('SIGTERM');
      
      // Give it a moment to shut down gracefully
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Force kill if still running
      if (!tinaProcess.killed) {
        tinaProcess.kill('SIGKILL');
      }
    }
    
    // Kill any remaining TinaCMS processes
    await killProcess('tinacms dev');
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('[tina-docker] Received SIGINT, cleaning up...');
  await killProcess('tinacms dev');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[tina-docker] Received SIGTERM, cleaning up...');
  await killProcess('tinacms dev');
  process.exit(0);
});

// Run the main function
main().catch((error) => {
  console.error('[tina-docker] Unhandled error:', error);
  process.exit(1);
});
