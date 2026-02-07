# JSDoc Style Guide

This guide explains how to document functions in the Clerky codebase.

## Quick Start

Run `npm run docs` to generate documentation at `docs/api/index.html`.

## Basic Function Documentation

```javascript
/**
 * Brief one-line description of what the function does.
 *
 * Optional longer description with more details about behavior,
 * edge cases, or important notes.
 *
 * @async                           // Include if function returns a Promise
 * @param {string} paramName - Description of the parameter
 * @param {Object} options - Options object
 * @param {string} options.key - Nested property description
 * @param {number} [optional=10] - Optional param with default value
 * @returns {Promise<Object>} Description of return value
 * @throws {Error} When something goes wrong
 */
async function myFunction(paramName, options, optional = 10) {
  // implementation
}
```

## File Headers

Add at the top of each module:

```javascript
/**
 * @fileoverview Brief description of what this module does.
 *
 * Longer description of the module's purpose and responsibilities.
 *
 * @module path/to/module
 * @requires dependency-name
 */
```

## Common Type Annotations

| Type | Example |
|------|---------|
| Primitives | `{string}`, `{number}`, `{boolean}`, `{null}` |
| Arrays | `{Array<string>}`, `{string[]}` |
| Objects | `{Object}`, `{Object<string, number>}` |
| Union types | `{string\|null}`, `{number\|undefined}` |
| Any type | `{*}` |
| Promises | `{Promise<string>}` |
| Functions | `{Function}`, `{function(string): boolean}` |

## Documenting Object Parameters

```javascript
/**
 * @param {Object} user - The user object
 * @param {string} user.id - User's unique identifier
 * @param {string} user.name - User's display name
 * @param {string[]} [user.roles] - Optional array of roles
 */
```

## Documenting Return Objects

```javascript
/**
 * @returns {Object} Result object
 * @returns {boolean} returns.success - Whether operation succeeded
 * @returns {string} returns.message - Status message
 * @returns {Array} [returns.data] - Optional data array
 */
```

## Examples in Documentation

```javascript
/**
 * Sends a message to the AI provider.
 *
 * @example
 * // Simple text prompt
 * const result = await routeToAI('Summarize this text', userId);
 *
 * @example
 * // With chat messages
 * const result = await routeToAI({
 *   messages: [
 *     { role: 'system', content: 'You are helpful.' },
 *     { role: 'user', content: 'Hello!' }
 *   ]
 * }, userId);
 */
```

## What to Document

**Always document:**
- All exported functions
- Complex internal functions (>20 lines)
- Functions with non-obvious parameters
- Functions that throw errors

**Skip documentation for:**
- Simple one-liner helper functions
- Self-explanatory getters/setters
- Functions that just delegate to another function

## Prioritization

When adding documentation, prioritize:
1. `server/services/` - Core business logic
2. `server/controllers/` - API endpoints
3. `js/features/` - Frontend features
4. `modules/` - Shared modules

## Running Documentation

```bash
# Generate docs once
npm run docs

# Watch mode (regenerates on file changes)
npm run docs:watch
```

Output is written to `docs/api/`. Open `docs/api/index.html` in a browser to view.
