# Script Studio

Visual browser automation script editor & manager for TubeCLI.

## Features
- Create and manage browser automation scripts
- Visual step editor with drag-drop reordering
- Element picker with live browser preview
- Variable interpolation ({{variable_name}})
- Execution history and real-time logging
- Import/Export scripts as JSON
- Skill API for other extensions

## Step Types
- **Navigate**: Go to a URL
- **Click**: Click an element
- **Type**: Enter text into an input
- **Wait**: Wait for element to appear/disappear
- **Sleep**: Pause for duration
- **Evaluate**: Run JavaScript code
- **Extract**: Get text/attribute from element
- **Screenshot**: Capture page screenshot
- **Download**: Wait for and save downloads
- **Condition**: If/else branching
- **Loop**: Repeat steps N times
- **Keyboard**: Press keyboard keys

## API
- `GET /api/v1/scripts` — List all scripts
- `POST /api/v1/scripts` — Create script
- `GET /api/v1/scripts/{id}` — Get script
- `PUT /api/v1/scripts/{id}` — Update script
- `POST /api/v1/scripts/{id}/run` — Run script
- `GET /api/v1/scripts/skill/{slug}` — Get script by slug
- `POST /api/v1/scripts/skill/{slug}/run` — Run script by slug
