import { useState, useEffect } from 'react';
import { Task } from '../entities/useTask'; // Adjust the import as necessary

const useTaskManagement = (allTasks: Task[], selectedTopic: string | undefined, selectedSubtopic: string | undefined) => {
    const [filteredTasks, setFilteredTasks] = useState<Task[]>(allTasks); // State to hold filtered tasks

    useEffect(() => {
        // Filter tasks based on selected topic and subtopic
        const filtered = allTasks.filter((task) => {
            const matchesTopic = selectedTopic ? task.topic === selectedTopic : true;
            const matchesSubtopic = selectedSubtopic ? task.subtopic === selectedSubtopic : true;
            return matchesTopic && matchesSubtopic;
        });
        setFilteredTasks(filtered);
    }, [selectedTopic, selectedSubtopic, allTasks]);

    return filteredTasks;
};

export default useTaskManagement;
