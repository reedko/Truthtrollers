// services/createTask.ts
const createTask = async (taskData: any) => {
  console.log("lets try");
  try {
    const response = await fetch("http://localhost:5001/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(taskData),
    });

    const text = await response.text();
    console.log("Task creation response:", text);
  } catch (error) {
    console.error("Error adding task:", error);
  }
};

export default createTask;
