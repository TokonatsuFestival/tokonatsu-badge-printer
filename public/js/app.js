// Festival Badge Printer Client-side JavaScript

// Initialize Socket.io connection
const socket = io();

// Connection event handlers
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

// DOM ready handler
document.addEventListener('DOMContentLoaded', () => {
    console.log('Festival Badge Printer initialized');
    
    // Future: Initialize form handlers, queue updates, etc.
});