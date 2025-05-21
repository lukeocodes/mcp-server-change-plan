#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { VERSION } from "./version.js"
import { z } from "zod"
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

// Get application directory for fallback
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Storage configuration
const APP_NAME = 'mcp-change-plan'
const STORAGE_FILE_NAME = 'change_plans.json'

// Create a unique app ID to avoid conflicts with other instances
const APP_ID = crypto.createHash('md5').update(__dirname).digest('hex').substring(0, 8)

// Set up storage paths with multiple options
function getStoragePaths() {
  // 1. Check if a specific path is provided via environment variable
  const envStoragePath = process.env.STORAGE_PATH

  // 2. OS temporary directory
  const osTempDir = path.join(os.tmpdir(), APP_NAME, APP_ID)
  
  // 3. Local directory as fallback
  const localDir = path.join(__dirname, 'storage')
  
  // 4. Current working directory as last resort
  const cwdDir = path.join(process.cwd(), '.mcp-storage')

  // Order of preference for storage directories
  const storageDirs = [
    { path: envStoragePath, description: 'environment variable STORAGE_PATH' },
    { path: osTempDir, description: 'system temporary directory' },
    { path: localDir, description: 'application directory' },
    { path: cwdDir, description: 'current working directory' }
  ]

  // Filter out undefined paths and return the array
  return storageDirs.filter(dir => dir.path)
}

// Try to use the first available storage directory
function setupStorage() {
  const storageDirs = getStoragePaths()
  let usedDir = null
  let storagePath = null

  for (const dir of storageDirs) {
    try {
      // Try to create directory if it doesn't exist
      if (!fs.existsSync(dir.path)) {
        fs.mkdirSync(dir.path, { recursive: true })
      }
      
      // Verify we can write to this directory with a test
      const testFile = path.join(dir.path, '.write-test')
      fs.writeFileSync(testFile, 'test', 'utf8')
      fs.unlinkSync(testFile)
      
      usedDir = dir
      storagePath = path.join(dir.path, STORAGE_FILE_NAME)
      console.log(`Using ${dir.description} for storage: ${dir.path}`)
      break
    } catch (err) {
      console.warn(`Cannot use ${dir.description} for storage: ${err.message}`)
    }
  }

  if (!usedDir) {
    console.error('CRITICAL: No valid storage location found. Plans will only be stored in memory!')
    return null
  }

  return storagePath
}

// Set up storage path
const PLANS_FILE = setupStorage()

const server = new McpServer({
  name: "Change Plan MCP Server",
  version: VERSION,
})

// Initialize storage
const changePlans = new Map()

// Error handling utilities
const ErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  STORAGE_ERROR: 'STORAGE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
}

function createError(code, message, details = null) {
  const error = {
    error: true,
    code,
    message
  }
  
  if (details) {
    error.details = details
  }
  
  return error
}

function handleError(error) {
  console.error(`[ERROR] ${error.message}`)
  if (error.stack) {
    console.error(error.stack)
  }
  
  let code = ErrorCodes.INTERNAL_ERROR
  let message = 'An unexpected error occurred'
  
  if (error.code === 'ENOENT' || error.message.includes('not found')) {
    code = ErrorCodes.NOT_FOUND
    message = error.message
  } else if (error.name === 'ZodError' || error.message.includes('invalid')) {
    code = ErrorCodes.INVALID_INPUT
    message = error.message
  } else if (error.code === 'EACCES' || error.code === 'ENOSPC') {
    code = ErrorCodes.STORAGE_ERROR
    message = `Storage error: ${error.message}`
  }
  
  return createError(code, message, error.details || error.stack)
}

// Load existing plans from file if exists
function loadPlans() {
  try {
    if (PLANS_FILE && fs.existsSync(PLANS_FILE)) {
      const data = fs.readFileSync(PLANS_FILE, 'utf8')
      const plans = JSON.parse(data)
      
      plans.forEach(plan => {
        changePlans.set(plan.id, plan)
      })
      
      console.log(`Loaded ${plans.length} change plans from storage`)
    }
  } catch (error) {
    console.error(`Error loading change plans: ${error.message}`)
    // Continue execution even if loading fails
  }
}

// Save plans to file
function savePlans() {
  if (!PLANS_FILE) {
    console.warn('No storage path available. Plans will only be stored in memory!')
    return false
  }
  
  try {
    const plans = Array.from(changePlans.values())
    fs.writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2), 'utf8')
    return true
  } catch (error) {
    console.error(`Error saving change plans: ${error.message}`)
    return false
  }
}

// Load plans on startup
loadPlans()

/**
 * @api {tool} create_change_plan Create a new change plan
 * @apiName CreateChangePlan
 * @apiGroup ChangePlan
 * @apiDescription Create a new change plan with multiple steps
 * 
 * @apiParam {String} name Name of the change plan
 * @apiParam {Object[]} steps Array of step objects
 * @apiParam {String} steps.title Title of the step
 * @apiParam {String} steps.description Description of what needs to be done
 * @apiParam {String} [steps.context] Additional context for the step
 * @apiParam {String[]} [steps.dependsOn] Array of step IDs that must be completed before this step
 * @apiParam {String} [steps.priority] Priority level of the step: 'high', 'medium', or 'low' (default: 'medium')
 * 
 * @apiSuccess {Object} content Response content
 * @apiSuccess {String} content.type Content type
 * @apiSuccess {String} content.text JSON string containing the created change plan
 * 
 * @apiError {Object} content.text JSON string containing error details
 * @apiError {Boolean} content.text.error Always true for errors
 * @apiError {String} content.text.code Error code
 * @apiError {String} content.text.message Error message
 * @apiError {String} [content.text.details] Additional error details if available
 */
server.tool("create_change_plan", "Create a new change plan with multiple steps. Steps can include a title, description, optional context, dependencies on other steps, and priority level.", {
  name: z.string().min(1, "Name is required").describe("The name of the change plan"),
  steps: z.array(
    z.object({
      title: z.string().min(1, "Step title is required").describe("Title of the step"),
      description: z.string().min(1, "Step description is required").describe("Description of what needs to be done"),
      context: z.string().optional().describe("Additional context for the step"),
      dependsOn: z.array(z.string()).optional().describe("Array of step IDs that must be completed before this step"),
      priority: z.enum(['high', 'medium', 'low']).optional().default('medium').describe("Priority level of the step: 'high', 'medium', or 'low'")
    })
  ).min(1, "At least one step is required").describe("Array of step objects")
}, async ({ name, steps }) => {
  try {
    // Validate step dependencies
    const stepIds = steps.map((_, index) => index.toString());
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      
      if (step.dependsOn && step.dependsOn.length > 0) {
        // Check if all dependencies exist
        for (const depId of step.dependsOn) {
          if (!stepIds.includes(depId)) {
            return {
              content: [{ 
                type: "text", 
                text: JSON.stringify(
                  createError(
                    ErrorCodes.INVALID_INPUT, 
                    `Step ${i} depends on non-existent step ID: ${depId}`
                  ), 
                  null, 
                  2
                ) 
              }]
            };
          }
          
          // Check for circular dependencies
          if (depId === i.toString()) {
            return {
              content: [{ 
                type: "text", 
                text: JSON.stringify(
                  createError(
                    ErrorCodes.INVALID_INPUT, 
                    `Step ${i} cannot depend on itself`
                  ), 
                  null, 
                  2
                ) 
              }]
            };
          }
        }
      }
    }
    
    const id = Date.now().toString();
    const changePlan = {
      id,
      name,
      steps: steps.map((step, index) => ({
        id: index.toString(),
        title: step.title,
        description: step.description,
        context: step.context || "",
        dependsOn: step.dependsOn || [],
        priority: step.priority || 'medium',
        completed: false,
        createdAt: new Date().toISOString()
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    changePlans.set(id, changePlan);
    
    // Save plans to file
    if (!savePlans()) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.STORAGE_ERROR, 
              "Failed to save change plan to storage. The plan was created in memory only."
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    return {
      content: [{ type: "text", text: JSON.stringify(changePlan, null, 2) }]
    };
  } catch (error) {
  return {
      content: [{ type: "text", text: JSON.stringify(handleError(error), null, 2) }]
    };
  }
});

/**
 * @api {tool} get_change_plans Get all change plans
 * @apiName GetChangePlans
 * @apiGroup ChangePlan
 * @apiDescription Get a list of all change plans
 * 
 * @apiSuccess {Object} content Response content
 * @apiSuccess {String} content.type Content type
 * @apiSuccess {String} content.text JSON string containing all change plans
 * 
 * @apiError {Object} content.text JSON string containing error details
 * @apiError {Boolean} content.text.error Always true for errors
 * @apiError {String} content.text.code Error code
 * @apiError {String} content.text.message Error message
 * @apiError {String} [content.text.details] Additional error details if available
 */
server.tool("get_change_plans", "Get a list of all change plans.", {}, 
async () => {
  try {
    const allPlans = Array.from(changePlans.values());
    
    return {
      content: [{ type: "text", text: JSON.stringify(allPlans, null, 2) }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: JSON.stringify(handleError(error), null, 2) }]
    };
  }
});

/**
 * @api {tool} get_change_plan Get a specific change plan
 * @apiName GetChangePlan
 * @apiGroup ChangePlan
 * @apiDescription Get details of a specific change plan by ID
 * 
 * @apiParam {String} id ID of the change plan to retrieve
 * 
 * @apiSuccess {Object} content Response content
 * @apiSuccess {String} content.type Content type
 * @apiSuccess {String} content.text JSON string containing the change plan
 * 
 * @apiError {Object} content.text JSON string containing error details
 * @apiError {Boolean} content.text.error Always true for errors
 * @apiError {String} content.text.code Error code
 * @apiError {String} content.text.message Error message
 * @apiError {String} [content.text.details] Additional error details if available
 */
server.tool("get_change_plan", "Get details of a specific change plan by ID.", {
  id: z.string().min(1, "Plan ID is required").describe("The ID of the change plan to retrieve")
}, async ({ id }) => {
  try {
    const changePlan = changePlans.get(id);
    
    if (!changePlan) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.NOT_FOUND, 
              `Change plan with ID ${id} not found`
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    return {
      content: [{ type: "text", text: JSON.stringify(changePlan, null, 2) }]
    };
  } catch (error) {
  return {
      content: [{ type: "text", text: JSON.stringify(handleError(error), null, 2) }]
    };
  }
});

/**
 * @api {tool} get_next_step Get the next incomplete step from a change plan
 * @apiName GetNextStep
 * @apiGroup ChangePlan
 * @apiDescription Get the next incomplete step from a change plan, respecting step dependencies and considering priorities
 * 
 * @apiParam {String} planId ID of the change plan
 * 
 * @apiSuccess {Object} content Response content
 * @apiSuccess {String} content.type Content type
 * @apiSuccess {String} content.text JSON string containing the next step or a completion message
 * 
 * @apiError {Object} content.text JSON string containing error details
 * @apiError {Boolean} content.text.error Always true for errors
 * @apiError {String} content.text.code Error code
 * @apiError {String} content.text.message Error message
 * @apiError {String} [content.text.details] Additional error details if available
 */
server.tool("get_next_step", "Get the next incomplete step from a change plan, respecting step dependencies and considering priorities.", {
  planId: z.string().min(1, "Plan ID is required").describe("The ID of the change plan")
}, async ({ planId }) => {
  try {
    const changePlan = changePlans.get(planId);
    
    if (!changePlan) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.NOT_FOUND, 
              `Change plan with ID ${planId} not found`
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    // Find all incomplete steps
    const incompleteSteps = changePlan.steps.filter(step => !step.completed);
    
    if (incompleteSteps.length === 0) {
      return {
        content: [{ type: "text", text: JSON.stringify({ message: "All steps are completed!" }, null, 2) }]
      };
    }
    
    // Find steps that are ready to be worked on (all dependencies are complete)
    const readySteps = incompleteSteps.filter(step => {
      // If no dependencies, it's ready
      if (!step.dependsOn || step.dependsOn.length === 0) {
        return true;
      }
      
      // Check if all dependencies are completed
      return step.dependsOn.every(depId => {
        const depStep = changePlan.steps.find(s => s.id === depId);
        return depStep && depStep.completed;
      });
    });
    
    if (readySteps.length === 0) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({ 
            message: "There are incomplete steps, but all have unmet dependencies.", 
            incompleteSteps: incompleteSteps 
          }, null, 2) 
        }]
      };
    }
    
    // Sort by priority: high > medium > low
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const sortedSteps = [...readySteps].sort((a, b) => {
      return priorityOrder[a.priority || 'medium'] - priorityOrder[b.priority || 'medium'];
    });
    
    // Return the highest priority ready step
    return {
      content: [{ type: "text", text: JSON.stringify(sortedSteps[0], null, 2) }]
    };
  } catch (error) {
  return {
      content: [{ type: "text", text: JSON.stringify(handleError(error), null, 2) }]
    };
  }
});

/**
 * @api {tool} mark_step_complete Mark a step as complete
 * @apiName MarkStepComplete
 * @apiGroup ChangePlan
 * @apiDescription Mark a specific step in a change plan as complete
 * 
 * @apiParam {String} planId ID of the change plan
 * @apiParam {String} stepId ID of the step to mark as complete
 * 
 * @apiSuccess {Object} content Response content
 * @apiSuccess {String} content.type Content type
 * @apiSuccess {String} content.text JSON string containing the updated step
 * 
 * @apiError {Object} content.text JSON string containing error details
 * @apiError {Boolean} content.text.error Always true for errors
 * @apiError {String} content.text.code Error code
 * @apiError {String} content.text.message Error message
 * @apiError {String} [content.text.details] Additional error details if available
 */
server.tool("mark_step_complete", "Mark a specific step in a change plan as complete.", {
  planId: z.string().min(1, "Plan ID is required").describe("The ID of the change plan"),
  stepId: z.string().min(1, "Step ID is required").describe("The ID of the step to mark as complete")
}, async ({ planId, stepId }) => {
  try {
    const changePlan = changePlans.get(planId);
    
    if (!changePlan) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.NOT_FOUND, 
              `Change plan with ID ${planId} not found`
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    const step = changePlan.steps.find(s => s.id === stepId);
    
    if (!step) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.NOT_FOUND, 
              `Step with ID ${stepId} not found in plan ${planId}`
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    if (step.completed) {
      return {
        content: [{ type: "text", text: JSON.stringify({ 
          message: "Step is already marked as complete",
          step
        }, null, 2) }]
      };
    }
    
    step.completed = true;
    step.completedAt = new Date().toISOString();
    changePlan.updatedAt = new Date().toISOString();
    
    // Save plans to file
    if (!savePlans()) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.STORAGE_ERROR, 
              "Failed to save changes to storage. The changes were applied in memory only."
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    return {
      content: [{ type: "text", text: JSON.stringify(step, null, 2) }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: JSON.stringify(handleError(error), null, 2) }]
    };
  }
});

/**
 * @api {tool} add_step Add a new step to a change plan
 * @apiName AddStep
 * @apiGroup ChangePlan
 * @apiDescription Add a new step to an existing change plan
 * 
 * @apiParam {String} planId ID of the change plan
 * @apiParam {String} title Title of the step
 * @apiParam {String} description Description of what needs to be done
 * @apiParam {String} [context] Additional context for the step
 * @apiParam {String[]} [dependsOn] Array of step IDs that must be completed before this step
 * @apiParam {String} [priority] Priority level of the step: 'high', 'medium', or 'low' (default: 'medium')
 * 
 * @apiSuccess {Object} content Response content
 * @apiSuccess {String} content.type Content type
 * @apiSuccess {String} content.text JSON string containing the added step
 * 
 * @apiError {Object} content.text JSON string containing error details
 * @apiError {Boolean} content.text.error Always true for errors
 * @apiError {String} content.text.code Error code
 * @apiError {String} content.text.message Error message
 * @apiError {String} [content.text.details] Additional error details if available
 */
server.tool("add_step", "Add a new step to an existing change plan.", {
  planId: z.string().min(1, "Plan ID is required").describe("The ID of the change plan"),
  title: z.string().min(1, "Title is required").describe("Title of the step"),
  description: z.string().min(1, "Description is required").describe("Description of what needs to be done"),
  context: z.string().optional().describe("Additional context for the step"),
  dependsOn: z.array(z.string()).optional().describe("Array of step IDs that must be completed before this step"),
  priority: z.enum(['high', 'medium', 'low']).optional().default('medium').describe("Priority level of the step: 'high', 'medium', or 'low'")
}, async ({ planId, title, description, context, dependsOn = [], priority = 'medium' }) => {
  try {
    const changePlan = changePlans.get(planId);
    
    if (!changePlan) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.NOT_FOUND, 
              `Change plan with ID ${planId} not found`
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    // Validate dependencies
    const stepIds = changePlan.steps.map(step => step.id);
    for (const depId of dependsOn) {
      if (!stepIds.includes(depId)) {
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify(
              createError(
                ErrorCodes.INVALID_INPUT, 
                `New step depends on non-existent step ID: ${depId}`
              ), 
              null, 
              2
            ) 
          }]
        };
      }
    }
    
    const newStepId = changePlan.steps.length.toString();
    const newStep = {
      id: newStepId,
      title,
      description,
      context: context || "",
      dependsOn: dependsOn || [],
      priority,
      completed: false,
      createdAt: new Date().toISOString()
    };
    
    changePlan.steps.push(newStep);
    changePlan.updatedAt = new Date().toISOString();
    
    // Save plans to file
    if (!savePlans()) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.STORAGE_ERROR, 
              "Failed to save changes to storage. The changes were applied in memory only."
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    return {
      content: [{ type: "text", text: JSON.stringify(newStep, null, 2) }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: JSON.stringify(handleError(error), null, 2) }]
    };
  }
});

/**
 * @api {tool} update_step Update an existing step
 * @apiName UpdateStep
 * @apiGroup ChangePlan
 * @apiDescription Update details of an existing step in a change plan
 * 
 * @apiParam {String} planId ID of the change plan
 * @apiParam {String} stepId ID of the step to update
 * @apiParam {String} [title] New title of the step
 * @apiParam {String} [description] New description of what needs to be done
 * @apiParam {String} [context] New additional context for the step
 * @apiParam {String[]} [dependsOn] New array of step IDs that must be completed before this step
 * @apiParam {String} [priority] New priority level of the step: 'high', 'medium', or 'low'
 * @apiParam {Boolean} [completed] New completion status
 * 
 * @apiSuccess {Object} content Response content
 * @apiSuccess {String} content.type Content type
 * @apiSuccess {String} content.text JSON string containing the updated step
 * 
 * @apiError {Object} content.text JSON string containing error details
 * @apiError {Boolean} content.text.error Always true for errors
 * @apiError {String} content.text.code Error code
 * @apiError {String} content.text.message Error message
 * @apiError {String} [content.text.details] Additional error details if available
 */
server.tool("update_step", "Update details of an existing step in a change plan.", {
  planId: z.string().min(1, "Plan ID is required").describe("The ID of the change plan"),
  stepId: z.string().min(1, "Step ID is required").describe("The ID of the step to update"),
  title: z.string().optional().describe("New title of the step"),
  description: z.string().optional().describe("New description of what needs to be done"),
  context: z.string().optional().describe("New additional context for the step"),
  dependsOn: z.array(z.string()).optional().describe("New array of step IDs that must be completed before this step"),
  priority: z.enum(['high', 'medium', 'low']).optional().describe("New priority level of the step: 'high', 'medium', or 'low'"),
  completed: z.boolean().optional().describe("New completion status")
}, async ({ planId, stepId, title, description, context, dependsOn, priority, completed }) => {
  try {
    const changePlan = changePlans.get(planId);
    
    if (!changePlan) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.NOT_FOUND, 
              `Change plan with ID ${planId} not found`
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    const step = changePlan.steps.find(s => s.id === stepId);
    
    if (!step) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.NOT_FOUND, 
              `Step with ID ${stepId} not found in plan ${planId}`
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    let hasChanges = false;
    
    if (title !== undefined && title !== step.title) {
      step.title = title;
      hasChanges = true;
    }
    
    if (description !== undefined && description !== step.description) {
      step.description = description;
      hasChanges = true;
    }
    
    if (context !== undefined && context !== step.context) {
      step.context = context;
      hasChanges = true;
    }
    
    if (dependsOn !== undefined) {
      // Validate dependencies
      const stepIds = changePlan.steps.map(s => s.id);
      for (const depId of dependsOn) {
        if (!stepIds.includes(depId)) {
          return {
            content: [{ 
              type: "text", 
              text: JSON.stringify(
                createError(
                  ErrorCodes.INVALID_INPUT, 
                  `Step depends on non-existent step ID: ${depId}`
                ), 
                null, 
                2
              ) 
            }]
          };
        }
        
        if (depId === stepId) {
          return {
            content: [{ 
              type: "text", 
              text: JSON.stringify(
                createError(
                  ErrorCodes.INVALID_INPUT, 
                  `Step cannot depend on itself`
                ), 
                null, 
                2
              ) 
            }]
          };
        }
      }
      
      // Check if dependencies changed
      const depsChanged = dependsOn.length !== step.dependsOn.length || 
        dependsOn.some(id => !step.dependsOn.includes(id)) ||
        step.dependsOn.some(id => !dependsOn.includes(id));
        
      if (depsChanged) {
        step.dependsOn = dependsOn;
        hasChanges = true;
      }
    }
    
    if (priority !== undefined && priority !== step.priority) {
      step.priority = priority;
      hasChanges = true;
    }
    
    if (completed !== undefined && completed !== step.completed) {
      // Check if all dependencies are completed
      if (completed && step.dependsOn && step.dependsOn.length > 0) {
        const uncompletedDeps = step.dependsOn.filter(depId => {
          const depStep = changePlan.steps.find(s => s.id === depId);
          return depStep && !depStep.completed;
        });
        
        if (uncompletedDeps.length > 0) {
          return {
            content: [{ 
              type: "text", 
              text: JSON.stringify(
                createError(
                  ErrorCodes.INVALID_INPUT, 
                  `Cannot mark step as completed because it has uncompleted dependencies: ${uncompletedDeps.join(', ')}`
                ), 
                null, 
                2
              ) 
            }]
          };
        }
      }
      
      step.completed = completed;
      if (completed) {
        step.completedAt = new Date().toISOString();
      } else {
        delete step.completedAt;
      }
      hasChanges = true;
    }
    
    if (!hasChanges) {
      return {
        content: [{ type: "text", text: JSON.stringify({ 
          message: "No changes were made to the step",
          step
        }, null, 2) }]
      };
    }
    
    changePlan.updatedAt = new Date().toISOString();
    
    // Save plans to file
    if (!savePlans()) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.STORAGE_ERROR, 
              "Failed to save changes to storage. The changes were applied in memory only."
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    return {
      content: [{ type: "text", text: JSON.stringify(step, null, 2) }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: JSON.stringify(handleError(error), null, 2) }]
    };
  }
});

/**
 * @api {tool} delete_change_plan Delete a change plan
 * @apiName DeleteChangePlan
 * @apiGroup ChangePlan
 * @apiDescription Delete a change plan by ID
 * 
 * @apiParam {String} id ID of the change plan to delete
 * 
 * @apiSuccess {Object} content Response content
 * @apiSuccess {String} content.type Content type
 * @apiSuccess {String} content.text JSON string containing success message
 * 
 * @apiError {Object} content.text JSON string containing error details
 * @apiError {Boolean} content.text.error Always true for errors
 * @apiError {String} content.text.code Error code
 * @apiError {String} content.text.message Error message
 * @apiError {String} [content.text.details] Additional error details if available
 */
server.tool("delete_change_plan", "Delete a change plan by ID.", {
  id: z.string().min(1, "Plan ID is required").describe("The ID of the change plan to delete")
}, async ({ id }) => {
  try {
    const exists = changePlans.has(id);
    
    if (!exists) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.NOT_FOUND, 
              `Change plan with ID ${id} not found`
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    changePlans.delete(id);
    
    // Save plans to file
    if (!savePlans()) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.STORAGE_ERROR, 
              "Failed to save changes to storage. The plan was deleted from memory only."
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    return {
      content: [{ type: "text", text: JSON.stringify({ message: "Change plan deleted successfully" }, null, 2) }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: JSON.stringify(handleError(error), null, 2) }]
    };
  }
});

/**
 * @api {tool} search_change_plans Search for change plans
 * @apiName SearchChangePlans
 * @apiGroup ChangePlan
 * @apiDescription Search for change plans by name and filter by completion status
 * 
 * @apiParam {String} [searchTerm] Optional search term to filter plans by name (case-insensitive partial match)
 * @apiParam {String} [status] Optional status filter: 'completed', 'in-progress', or 'all' (default: 'all')
 * 
 * @apiSuccess {Object} content Response content
 * @apiSuccess {String} content.type Content type
 * @apiSuccess {String} content.text JSON string containing matching change plans
 * 
 * @apiError {Object} content.text JSON string containing error details
 * @apiError {Boolean} content.text.error Always true for errors
 * @apiError {String} content.text.code Error code
 * @apiError {String} content.text.message Error message
 * @apiError {String} [content.text.details] Additional error details if available
 */
server.tool("search_change_plans", "Search for change plans by name and filter by completion status.", {
  searchTerm: z.string().optional().describe("Optional search term to filter plans by name (case-insensitive partial match)"),
  status: z.enum(['completed', 'in-progress', 'all']).optional().default('all').describe("Optional status filter: 'completed', 'in-progress', or 'all'")
}, async ({ searchTerm, status }) => {
  try {
    let allPlans = Array.from(changePlans.values());
    let filteredPlans = allPlans;
    
    // Filter by name if a search term is provided
    if (searchTerm && searchTerm.trim() !== '') {
      const term = searchTerm.trim().toLowerCase();
      filteredPlans = filteredPlans.filter(plan => 
        plan.name.toLowerCase().includes(term)
      );
    }
    
    // Filter by status if not 'all'
    if (status !== 'all') {
      filteredPlans = filteredPlans.filter(plan => {
        // Check completion status of all steps
        const allStepsCompleted = plan.steps.every(step => step.completed);
        const anyStepCompleted = plan.steps.some(step => step.completed);
        const noSteps = plan.steps.length === 0;
        
        if (status === 'completed') {
          return allStepsCompleted && !noSteps;
        } else if (status === 'in-progress') {
          return (anyStepCompleted && !allStepsCompleted) || noSteps;
        }
        return true;
      });
    }
    
    // Add meta information to the response
    const result = {
      total: filteredPlans.length,
      plans: filteredPlans,
      filters: {
        searchTerm: searchTerm || '',
        status
      }
    };
    
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: JSON.stringify(handleError(error), null, 2) }]
    };
  }
});

/**
 * @api {tool} export_change_plan Export a change plan to JSON
 * @apiName ExportChangePlan
 * @apiGroup ChangePlan
 * @apiDescription Export a specific change plan to JSON format for backup or sharing
 * 
 * @apiParam {String} id ID of the change plan to export
 * 
 * @apiSuccess {Object} content Response content
 * @apiSuccess {String} content.type Content type
 * @apiSuccess {String} content.text JSON string containing the exported change plan
 * 
 * @apiError {Object} content.text JSON string containing error details
 * @apiError {Boolean} content.text.error Always true for errors
 * @apiError {String} content.text.code Error code
 * @apiError {String} content.text.message Error message
 * @apiError {String} [content.text.details] Additional error details if available
 */
server.tool("export_change_plan", "Export a specific change plan to JSON format for backup or sharing.", {
  id: z.string().min(1, "Plan ID is required").describe("The ID of the change plan to export")
}, async ({ id }) => {
  try {
    const changePlan = changePlans.get(id);
    
    if (!changePlan) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.NOT_FOUND, 
              `Change plan with ID ${id} not found`
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    const exportData = {
      exportedAt: new Date().toISOString(),
      changePlan
    };
    
    return {
      content: [{ type: "text", text: JSON.stringify(exportData, null, 2) }]
    };
  } catch (error) {
  return {
      content: [{ type: "text", text: JSON.stringify(handleError(error), null, 2) }]
    };
  }
});

/**
 * @api {tool} import_change_plan Import a change plan from JSON
 * @apiName ImportChangePlan
 * @apiGroup ChangePlan
 * @apiDescription Import a change plan from JSON format, optionally overwriting an existing plan with the same ID
 * 
 * @apiParam {String} data JSON string containing the change plan data to import
 * @apiParam {Boolean} [overwrite=false] Whether to overwrite an existing plan with the same ID (default: false)
 * 
 * @apiSuccess {Object} content Response content
 * @apiSuccess {String} content.type Content type
 * @apiSuccess {String} content.text JSON string containing the imported change plan
 * 
 * @apiError {Object} content.text JSON string containing error details
 * @apiError {Boolean} content.text.error Always true for errors
 * @apiError {String} content.text.code Error code
 * @apiError {String} content.text.message Error message
 * @apiError {String} [content.text.details] Additional error details if available
 */
server.tool("import_change_plan", "Import a change plan from JSON format, optionally overwriting an existing plan with the same ID.", {
  data: z.string().min(1, "JSON data is required").describe("JSON string containing the change plan data to import"),
  overwrite: z.boolean().optional().default(false).describe("Whether to overwrite an existing plan with the same ID (default: false)")
}, async ({ data, overwrite = false }) => {
  try {
    let importData;
    try {
      importData = JSON.parse(data);
    } catch (err) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.INVALID_INPUT, 
              "Invalid JSON format. The data could not be parsed."
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    // Extract the change plan from the data
    const planToImport = importData.changePlan || importData;
    
    // Validate the plan structure
    if (!planToImport.id || !planToImport.name || !Array.isArray(planToImport.steps)) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.INVALID_INPUT, 
              "Invalid change plan format. The data must include id, name, and steps array."
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    // Check if a plan with the same ID already exists
    const existingPlan = changePlans.get(planToImport.id);
    if (existingPlan && !overwrite) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.INVALID_INPUT, 
              `A change plan with ID ${planToImport.id} already exists. Set overwrite=true to replace it.`
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    // Add import metadata
    const importedPlan = {
      ...planToImport,
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // Ensure all steps have the required fields
    importedPlan.steps = importedPlan.steps.map((step, index) => ({
      id: step.id || index.toString(),
      title: step.title,
      description: step.description,
      context: step.context || "",
      dependsOn: step.dependsOn || [],
      priority: step.priority || 'medium',
      completed: step.completed || false,
      createdAt: step.createdAt || new Date().toISOString(),
      completedAt: step.completed ? (step.completedAt || new Date().toISOString()) : undefined
    }));
    
    // Save the imported plan
    changePlans.set(importedPlan.id, importedPlan);
    
    // Save plans to file
    if (!savePlans()) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(
            createError(
              ErrorCodes.STORAGE_ERROR, 
              "Failed to save the imported plan to storage. The plan was imported in memory only."
            ), 
            null, 
            2
          ) 
        }]
      };
    }
    
    return {
      content: [{ type: "text", text: JSON.stringify(importedPlan, null, 2) }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: JSON.stringify(handleError(error), null, 2) }]
    };
  }
});

const transport = new StdioServerTransport()
await server.connect(transport)
