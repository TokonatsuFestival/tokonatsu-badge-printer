# Festival Badge Printer - Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying the Festival Badge Printer system for registration teams. The system is designed to run locally on registration computers with USB-connected printers.

## System Requirements

### Hardware Requirements
- **Computer**: Modern laptop or desktop computer
- **RAM**: Minimum 4GB, recommended 8GB
- **Storage**: At least 2GB free space
- **USB Ports**: Available USB port for printer connection
- **Network**: Local network capability for multi-station setups

### Software Requirements
- **Operating System**: Windows 10+, macOS 10.14+, or Linux Ubuntu 18.04+
- **Node.js**: Version 18.0 or higher
- **npm**: Version 8.0 or higher (included with Node.js)
- **Printer Drivers**: Appropriate drivers for your USB printer

### Supported Printers
- Any USB-connected printer with standard drivers
- Recommended: Label printers or small format printers
- Tested with: Brother QL series, DYMO LabelWriter series

## Installation Instructions

### 1. Download and Extract

```bash
# Download the application (replace with actual download URL)
wget https://github.com/your-org/festival-badge-printer/archive/main.zip
unzip main.zip
cd festival-badge-printer-main
```

### 2. Install Dependencies

```bash
# Install Node.js dependencies
npm install

# For production deployment
npm install --production
```

### 3. Configure Templates

1. Place your Adobe InDesign template files in the `templates/` directory
2. Update template configurations in the database or configuration files
3. Ensure template preview images are available

```bash
# Template directory structure
templates/
├── badge-template-1.indd
├── badge-template-2.indd
├── previews/
│   ├── badge-template-1.png
│   └── badge-template-2.png
└── background.png
```

### 4. Database Setup

The application uses SQLite for local data storage. The database will be created automatically on first run.

```bash
# Database will be created at
data/festival_badges.db
```

### 5. Printer Setup

1. Connect your USB printer to the computer
2. Install printer drivers according to manufacturer instructions
3. Test printer functionality with a test page
4. Note the printer name for configuration

## Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Database Configuration
DB_PATH=./data/festival_badges.db

# Logging Configuration
LOG_LEVEL=info
LOG_DIR=./logs

# Queue Configuration
MAX_QUEUE_SIZE=50
MAX_RETRIES=3
PROCESSING_TIMEOUT=30000

# Template Configuration
TEMPLATE_DIR=./templates
TEMP_DIR=./data/temp
```

### Printer Configuration

Edit `server/config/printer-presets.json`:

```json
{
  "default": {
    "paperSize": "4x6",
    "quality": "high",
    "orientation": "portrait",
    "margins": {
      "top": 0,
      "right": 0,
      "bottom": 0,
      "left": 0
    }
  },
  "badge-standard": {
    "paperSize": "3.5x2.25",
    "quality": "high",
    "orientation": "landscape",
    "margins": {
      "top": 0.1,
      "right": 0.1,
      "bottom": 0.1,
      "left": 0.1
    }
  }
}
```

## Running the Application

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

### As a Service (Linux/macOS)

Create a systemd service file `/etc/systemd/system/festival-badge-printer.service`:

```ini
[Unit]
Description=Festival Badge Printer
After=network.target

[Service]
Type=simple
User=festival
WorkingDirectory=/path/to/festival-badge-printer
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl enable festival-badge-printer
sudo systemctl start festival-badge-printer
sudo systemctl status festival-badge-printer
```

### Windows Service

Use `node-windows` or similar tools to create a Windows service:

```bash
npm install -g node-windows
npm link node-windows
```

## Network Setup

### Single Station Setup

1. Start the application on the registration computer
2. Access via `http://localhost:3000`
3. Connect printer directly to the same computer

### Multi-Station Setup

1. Designate one computer as the server
2. Start the application on the server computer
3. Note the server's IP address (e.g., 192.168.1.100)
4. Access from other stations via `http://192.168.1.100:3000`
5. Connect printer to the server computer

### Firewall Configuration

Ensure port 3000 is open for incoming connections:

```bash
# Linux (ufw)
sudo ufw allow 3000

# Windows
# Add inbound rule for port 3000 in Windows Firewall

# macOS
# System Preferences > Security & Privacy > Firewall > Options
# Add festival-badge-printer to allowed applications
```

## Testing the Installation

### 1. System Health Check

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-01-18T10:00:00.000Z",
  "uptime": 123.456,
  "services": {
    "database": "connected",
    "queueManager": "initialized"
  }
}
```

### 2. Template Verification

```bash
curl http://localhost:3000/api/templates
```

Should return available templates with proper structure.

### 3. Printer Diagnostics

```bash
curl http://localhost:3000/api/diagnostics?component=printer
```

Should show printer status and connectivity.

### 4. End-to-End Test

1. Open web browser to `http://localhost:3000`
2. Select a badge template
3. Enter test UID and badge name
4. Submit the badge
5. Verify it appears in the queue
6. Check that it processes and prints successfully

### 5. Run Automated Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm test -- tests/integration-complete-workflow.test.js
npm test -- tests/concurrent-users.test.js
npm test -- tests/printer-failure-recovery.test.js
npm test -- tests/performance-optimization.test.js
npm test -- tests/template-compatibility.test.js
```

## Troubleshooting

### Common Issues

#### 1. Printer Not Detected

**Symptoms**: No printers shown in diagnostics
**Solutions**:
- Verify printer is connected and powered on
- Check USB cable connection
- Install/update printer drivers
- Restart the application
- Check system printer settings

```bash
# Check system printers (Linux/macOS)
lpstat -p

# Check system printers (Windows)
wmic printer list brief
```

#### 2. Template Loading Errors

**Symptoms**: Templates not appearing or badge generation fails
**Solutions**:
- Verify template files exist in `templates/` directory
- Check file permissions
- Validate template configuration
- Review application logs

```bash
# Check template directory
ls -la templates/

# Check logs
tail -f logs/combined.log
```

#### 3. Database Connection Issues

**Symptoms**: Application fails to start or data not persisting
**Solutions**:
- Check database file permissions
- Verify disk space availability
- Review database logs
- Restart application

```bash
# Check database file
ls -la data/festival_badges.db

# Check disk space
df -h
```

#### 4. Network Connectivity Issues

**Symptoms**: Cannot access from other computers
**Solutions**:
- Verify firewall settings
- Check network configuration
- Confirm IP address and port
- Test with curl or browser

```bash
# Test network connectivity
ping 192.168.1.100
telnet 192.168.1.100 3000
```

#### 5. Performance Issues

**Symptoms**: Slow response times or timeouts
**Solutions**:
- Check system resources (CPU, memory)
- Review application logs for errors
- Optimize queue settings
- Restart application

```bash
# Check system resources
top
htop
free -h

# Check application performance
curl http://localhost:3000/api/logs/stats
```

### Log Files

Application logs are stored in the `logs/` directory:

- `combined.log`: All application logs
- `access.log`: HTTP request logs
- `queue.log`: Print queue specific logs

```bash
# View recent logs
tail -f logs/combined.log

# Search for errors
grep -i error logs/combined.log

# View access logs
tail -f logs/access.log
```

### Diagnostic Tools

#### System Diagnostics

```bash
# Full system diagnostics
curl http://localhost:3000/api/diagnostics

# Component-specific diagnostics
curl http://localhost:3000/api/diagnostics?component=printer
curl http://localhost:3000/api/diagnostics?component=database
curl http://localhost:3000/api/diagnostics?component=templates

# Generate diagnostic report
curl http://localhost:3000/api/diagnostics/report?format=text
```

#### Performance Monitoring

```bash
# Log statistics
curl http://localhost:3000/api/logs/stats

# Recent logs
curl http://localhost:3000/api/logs/recent?category=combined&lines=100

# Queue status
curl http://localhost:3000/api/queue
```

## Maintenance

### Regular Maintenance Tasks

#### Daily
- Check printer paper/ink levels
- Verify system is running
- Clear temporary files if needed

#### Weekly
- Review log files for errors
- Check disk space usage
- Test backup procedures

#### Monthly
- Update dependencies if needed
- Review and archive old logs
- Performance optimization review

### Backup Procedures

#### Database Backup

```bash
# Create database backup
cp data/festival_badges.db data/backups/festival_badges_$(date +%Y%m%d).db

# Automated backup script
#!/bin/bash
BACKUP_DIR="data/backups"
mkdir -p $BACKUP_DIR
cp data/festival_badges.db $BACKUP_DIR/festival_badges_$(date +%Y%m%d_%H%M%S).db

# Keep only last 30 days of backups
find $BACKUP_DIR -name "festival_badges_*.db" -mtime +30 -delete
```

#### Configuration Backup

```bash
# Backup configuration files
tar -czf config_backup_$(date +%Y%m%d).tar.gz \
  .env \
  server/config/ \
  templates/ \
  package.json
```

### Updates and Upgrades

#### Application Updates

```bash
# Stop the application
sudo systemctl stop festival-badge-printer

# Backup current installation
cp -r /path/to/festival-badge-printer /path/to/festival-badge-printer.backup

# Update application files
# (Download and extract new version)

# Install new dependencies
npm install

# Start the application
sudo systemctl start festival-badge-printer

# Verify functionality
curl http://localhost:3000/health
```

#### Dependency Updates

```bash
# Check for outdated packages
npm outdated

# Update dependencies
npm update

# Security audit
npm audit
npm audit fix
```

## Security Considerations

### Network Security
- Use local network only (avoid internet exposure)
- Configure firewall to restrict access
- Use strong passwords for system accounts
- Regular security updates

### Data Security
- Regular database backups
- Secure file permissions
- Log rotation and cleanup
- Access control for sensitive files

### Operational Security
- Train users on proper procedures
- Monitor for unusual activity
- Incident response procedures
- Regular security reviews

## Support and Contact

### Documentation
- Application logs: `logs/` directory
- Configuration files: `.env` and `server/config/`
- Template documentation: `templates/README.md`

### Getting Help
1. Check this deployment guide
2. Review application logs
3. Run diagnostic tools
4. Contact system administrator
5. Submit issue reports with logs and error details

### Performance Optimization Tips

1. **Hardware Optimization**
   - Use SSD storage for better performance
   - Ensure adequate RAM (8GB recommended)
   - Use wired network connections when possible

2. **Application Optimization**
   - Adjust queue size based on usage patterns
   - Optimize template files for faster processing
   - Regular log cleanup and maintenance

3. **Network Optimization**
   - Use dedicated network for registration systems
   - Minimize network latency
   - Consider load balancing for high-volume events

This deployment guide should provide comprehensive instructions for setting up and maintaining the Festival Badge Printer system in production environments.