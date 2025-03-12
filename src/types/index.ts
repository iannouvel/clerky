// User related types
export interface UserProfile {
    uid: string;
    email: string | null;
    displayName: string | null;
    lastLogin: string;
}

// Guideline related types
export interface GuidelineSummary {
    title: string;
    content: string;
    tags: string[];
}

export interface GuidelineData {
    [filename: string]: string;
}

// Prompt related types
export interface Prompt {
    title: string;
    description: string;
    prompt: string;
}

export interface PromptData {
    issues: Prompt;
    guidelines: Prompt;
    applyGuideline: Prompt;
}

// Error types
export interface ApiError {
    message: string;
    code: string;
    status?: number;
}

// Response types
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: ApiError;
} 