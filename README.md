# Festival Badge Printer

A web-based badge printing system for festival registration teams.

## Features

- Web-based interface for badge creation
- Internal template system
- USB printer support with presets
- Real-time print queue management
- Multi-user support for registration teams

## Setup

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- USB printer connected to the system

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:3000`

## Development

- `npm start` - Start the production server
- `npm run dev` - Start the development server with auto-reload
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode

## Project Structure

```
├── server/           # Backend server code
│   ├── index.js     # Main server entry point
│   ├── models/      # Database models
│   ├── routes/      # API routes
│   ├── services/    # Business logic
│   └── middleware/  # Express middleware
├── public/          # Frontend static files
│   ├── css/         # Stylesheets
│   ├── js/          # Client-side JavaScript
│   ├── images/      # Static images
│   └── index.html   # Main HTML file
└── templates/       # Badge template files
```

## License

MIT