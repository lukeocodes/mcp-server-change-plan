# Change Plan

A Model Context Protocol server that provides advanced change plan management capabilities. This server enables LLMs to methodically execute complex task sequences by creating structured plans with steps, dependencies, priorities, and progress tracking.

## Prerequisites

1. Node.js v20 or higher
   - [Download Node.js](https://nodejs.org/en/download/)
   - Verify installation: `node --version`

## Common Issues & Solutions

### Storage Issues

**Storage Directory Errors**

- **Cause**: Permission issues when creating storage directory or files
- **Solution**:
  - Ensure the user running the server has write access to the directory
  - For Docker setups, ensure proper volume mounting
  - If persistent storage is required, configure a shared volume

### Server Behavior

- The server persists change plans to a JSON file in a `storage` directory
- Plans are automatically loaded when the server starts
- Each step maintains creation and completion timestamps
- Dependencies between steps are enforced (steps with incomplete dependencies won't be returned as "next")

## Components

### Tools

- **create_change_plan**

  - Create a new change plan with multiple steps
  - Input:
    - `name` (string): Name of the change plan
    - `steps` (array): Array of step objects containing:
      - `title` (string): Title of the step
      - `description` (string): Description of what needs to be done
      - `context` (string, optional): Additional context for the step
      - `dependsOn` (string[], optional): Array of step IDs that must be completed before this step
      - `priority` (string, optional): Priority level: 'high', 'medium', or 'low'

- **get_change_plans**

  - Get a list of all change plans
  - Input: None

- **get_change_plan**

  - Get details of a specific change plan by ID
  - Input: `id` (string): ID of the change plan to retrieve

- **search_change_plans**

  - Search for change plans by name and filter by completion status
  - Input:
    - `searchTerm` (string, optional): Term to search for in plan names
    - `status` (string, optional): Filter by completion status: 'completed', 'in-progress', or 'all'

- **get_next_step**

  - Get the next incomplete step from a change plan, respecting dependencies and priorities
  - Input: `planId` (string): ID of the change plan

- **mark_step_complete**

  - Mark a specific step in a change plan as complete
  - Input:
    - `planId` (string): ID of the change plan
    - `stepId` (string): ID of the step to mark as complete

- **add_step**

  - Add a new step to an existing change plan
  - Input:
    - `planId` (string): ID of the change plan
    - `title` (string): Title of the step
    - `description` (string): Description of what needs to be done
    - `context` (string, optional): Additional context for the step
    - `dependsOn` (string[], optional): Array of step IDs that must be completed before this step
    - `priority` (string, optional): Priority level: 'high', 'medium', or 'low'

- **update_step**

  - Update details of an existing step in a change plan
  - Input:
    - `planId` (string): ID of the change plan
    - `stepId` (string): ID of the step to update
    - Various optional fields to update (title, description, context, dependsOn, priority, completed)

- **delete_change_plan**

  - Delete a change plan by ID
  - Input: `id` (string): ID of the change plan to delete

- **export_change_plan**

  - Export a specific change plan to JSON format for backup or sharing
  - Input: `id` (string): ID of the change plan to export

- **import_change_plan**
  - Import a change plan from JSON format
  - Input:
    - `data` (string): JSON string containing the change plan data to import
    - `overwrite` (boolean, optional): Whether to overwrite an existing plan with the same ID

## Usage with Claude Desktop

To use this server with the Claude Desktop app, add the following configuration to the "mcpServers" section of your `claude_desktop_config.json`:

### Docker

```json
{
  "mcpServers": {
    "change-plan": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-v",
        "${localStoragePath}/change-plans:/app/storage",
        "mcp/change-plan"
      ]
    }
  }
}
```

### NPX

```json
{
  "mcpServers": {
    "change-plan": {
      "command": "npx",
      "args": ["-y", "mcp-server-change-plan"]
    }
  }
}
```

## Usage with VS Code

For quick installation, use one of the one-click install buttons below...

[![Install with NPX in VS Code](https://img.shields.io/badge/VS_Code-NPM-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=change-plan&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mcp-server-change-plan%22%5D%7D) [![Install with NPX in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-NPM-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=change-plan&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mcp-server-change-plan%22%5D%7D&quality=insiders)

[![Install with Docker in VS Code](https://img.shields.io/badge/VS_Code-Docker-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=change-plan&config=%7B%22command%22%3A%22docker%22%2C%22args%22%3A%5B%22run%22%2C%22-i%22%2C%22--rm%22%2C%22-v%22%2C%22%24%7BlocalStoragePath%7D%2Fchange-plans%3A%2Fapp%2Fstorage%22%2C%22mcp%2Fchange-plan%22%5D%7D) [![Install with Docker in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Docker-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=change-plan&config=%7B%22command%22%3A%22docker%22%2C%22args%22%3A%5B%22run%22%2C%22-i%22%2C%22--rm%22%2C%22-v%22%2C%22%24%7BlocalStoragePath%7D%2Fchange-plans%3A%2Fapp%2Fstorage%22%2C%22mcp%2Fchange-plan%22%5D%7D&quality=insiders)

For manual installation, add the following JSON block to your User Settings (JSON) file in VS Code. You can do this by pressing `Ctrl + Shift + P` and typing `Preferences: Open User Settings (JSON)`.

Optionally, you can add it to a file called `.vscode/mcp.json` in your workspace. This will allow you to share the configuration with others.

> Note that the `mcp` key is not needed in the `.vscode/mcp.json` file.

```json
{
  "mcp": {
    "servers": {
      "change-plan": {
        "command": "npx",
        "args": ["-y", "mcp-server-change-plan"]
      }
    }
  }
}
```

For Docker installation:

```json
{
  "mcp": {
    "servers": {
      "change-plan": {
        "command": "docker",
        "args": [
          "run",
          "-i",
          "--rm",
          "-v",
          "${localStoragePath}/change-plans:/app/storage",
          "mcp/change-plan"
        ]
      }
    }
  }
}
```

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.
