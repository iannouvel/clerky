import { GuidelineSummary, Prompt, PromptData, UserProfile } from '../types';
import { ValidationError } from './errors';

// Type guard for checking if a value is a non-null object
function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

// Type guard for checking if a value is a string
function isString(value: unknown): value is string {
    return typeof value === 'string';
}

// Type guard for checking if a value is an array
function isArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

// Validate GuidelineSummary
export function isGuidelineSummary(value: unknown): value is GuidelineSummary {
    if (!isObject(value)) return false;
    
    return (
        isString(value.title) &&
        isString(value.content) &&
        isArray(value.tags) &&
        value.tags.every(isString)
    );
}

// Validate Prompt
export function isPrompt(value: unknown): value is Prompt {
    if (!isObject(value)) return false;
    
    return (
        isString(value.title) &&
        isString(value.description) &&
        isString(value.prompt)
    );
}

// Validate PromptData
export function isPromptData(value: unknown): value is PromptData {
    if (!isObject(value)) return false;
    
    return (
        isObject(value.issues) && isPrompt(value.issues) &&
        isObject(value.guidelines) && isPrompt(value.guidelines) &&
        isObject(value.applyGuideline) && isPrompt(value.applyGuideline)
    );
}

// Validate UserProfile
export function isUserProfile(value: unknown): value is UserProfile {
    if (!isObject(value)) return false;
    
    return (
        isString(value.uid) &&
        (value.email === null || isString(value.email)) &&
        (value.displayName === null || isString(value.displayName)) &&
        isString(value.lastLogin)
    );
}

// Validation functions that throw errors
export function validateGuidelineSummary(value: unknown): GuidelineSummary {
    if (!isGuidelineSummary(value)) {
        throw new ValidationError('Invalid guideline summary format');
    }
    return value;
}

export function validatePrompt(value: unknown): Prompt {
    if (!isPrompt(value)) {
        throw new ValidationError('Invalid prompt format');
    }
    return value;
}

export function validatePromptData(value: unknown): PromptData {
    if (!isPromptData(value)) {
        throw new ValidationError('Invalid prompt data format');
    }
    return value;
}

export function validateUserProfile(value: unknown): UserProfile {
    if (!isUserProfile(value)) {
        throw new ValidationError('Invalid user profile format');
    }
    return value;
}

// Sanitization functions
export function sanitizeString(value: string): string {
    return value.trim().replace(/[<>]/g, '');
}

export function sanitizeHtml(html: string): string {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]*>/g, '');
} 