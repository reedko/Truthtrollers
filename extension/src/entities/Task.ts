export interface Task {
    task_id: number;
    thumbnail: string;
    task_name: string;
    media_source: string;
    url: string;
    assigned: 'assigned' | 'unassigned';
    progress: 'Unassigned'|'Assigned' | 'Started' | 'Partially Complete' | 'Awaiting Evaluation' | 'Completed';
    users: string;  // This could be an array of user IDs/names
    details: string; // Link to the task details
    topic: string;
    subtopic: string;
}