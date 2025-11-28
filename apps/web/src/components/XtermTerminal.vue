<template>
  <div class="xterm-container">
    <div ref="terminalRef" class="terminal-wrapper"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { io, Socket } from 'socket.io-client';
import 'xterm/css/xterm.css';

interface Props {
  environmentId: string;
  resourceName: string;
}

const props = defineProps<Props>();

const terminalRef = ref<HTMLElement | null>(null);
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let socket: Socket | null = null;

onMounted(() => {
  if (!terminalRef.value) return;

  // Create terminal instance
  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Monaco, Menlo, "Courier New", monospace',
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#ffffff',
      selectionBackground: '#264f78',
    },
    rows: 30,
    cols: 100,
  });

  // Add addons
  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());

  // Open terminal in DOM
  terminal.open(terminalRef.value);
  fitAddon.fit();

  // Connect to WebSocket
  connectWebSocket();

  // Handle terminal input
  terminal.onData((data) => {
    if (socket && socket.connected) {
      socket.emit('terminal-input', {
        input: data,
        resourceName: props.resourceName,
      });
    }
  });

  // Handle window resize
  window.addEventListener('resize', handleResize);
});

async function connectWebSocket() {
  try {
    // Get WebSocket authentication token from API
    const apiUrl = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';
    const response = await fetch(`${apiUrl}/api/auth/ws-token`, {
      credentials: 'include', // Send session cookie
    });

    if (!response.ok) {
      throw new Error('Failed to get WebSocket token');
    }

    const { token } = await response.json();

    const wsUrl = apiUrl
      .replace('http://', 'ws://')
      .replace('https://', 'wss://');

    socket = io(`${wsUrl}/terminal`, {
      query: { token }, // Send token in query params
      transports: ['polling', 'websocket'],
    });
  } catch (error) {
    console.error('Failed to connect WebSocket:', error);
    if (terminal) {
      terminal.write('\r\n\x1b[1;31mFailed to authenticate WebSocket connection\x1b[0m\r\n');
    }
    return;
  }

  socket.on('connect', () => {
    console.log('WebSocket connected');

    // Start terminal session
    socket!.emit('start-terminal', {
      environmentId: props.environmentId,
      resourceName: props.resourceName,
    });
  });

  socket.on('terminal-output', (data: string) => {
    if (terminal) {
      terminal.write(data);
    }
  });

  socket.on('terminal-error', (error: string) => {
    if (terminal) {
      terminal.write(`\r\n\x1b[1;31mError: ${error}\x1b[0m\r\n`);
    }
  });

  socket.on('terminal-exit', (code: number) => {
    if (terminal) {
      terminal.write(`\r\n\x1b[1;33mProcess exited with code ${code}\x1b[0m\r\n`);
    }
  });

  socket.on('disconnect', () => {
    console.log('WebSocket disconnected');
    if (terminal) {
      terminal.write('\r\n\x1b[1;31mDisconnected from server\x1b[0m\r\n');
    }
  });

  socket.on('connect_error', (error) => {
    console.error('WebSocket connection error:', error);
    if (terminal) {
      terminal.write('\r\n\x1b[1;31mConnection error\x1b[0m\r\n');
    }
  });
}

function handleResize() {
  if (fitAddon) {
    fitAddon.fit();
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);

  if (socket) {
    socket.emit('stop-terminal', { resourceName: props.resourceName });
    socket.disconnect();
  }

  if (terminal) {
    terminal.dispose();
  }
});

// Watch for prop changes
watch(() => props.resourceName, async () => {
  // Reconnect if resource changes
  if (socket) {
    socket.disconnect();
  }
  if (terminal) {
    terminal.clear();
  }
  await connectWebSocket();
});
</script>

<style scoped>
.xterm-container {
  width: 100%;
  height: 100%;
  background: #1e1e1e;
  padding: 1rem;
  border-radius: 0.5rem;
  overflow: hidden;
}

.terminal-wrapper {
  height: 100%;
  width: 100%;
}

.terminal-wrapper :deep(.xterm) {
  height: 100%;
}

.terminal-wrapper :deep(.xterm-viewport) {
  overflow-y: auto;
}
</style>
