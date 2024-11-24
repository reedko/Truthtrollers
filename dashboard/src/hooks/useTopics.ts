import { useState, useEffect } from 'react';
import { Task } from '../entities/useTask'; // Adjust the import as necessary

const useTopics = (tasks: Task[]) => {
    const [topics, setTopics] = useState<string[]>([]);
    const [subtopics, setSubtopics] = useState<string[]>([]);

    useEffect(() => {
        const uniqueTopics = Array.from(new Set(tasks.map(task => task.topic))).filter(Boolean);
        const uniqueSubtopics = Array.from(new Set(tasks.map(task => task.subtopic))).filter(Boolean);
        
        setTopics(uniqueTopics);
        setSubtopics(uniqueSubtopics);
    }, [tasks]);

    return { topics, subtopics };
};

export default useTopics;
