import useTopics from "./useTopics";

    const useTopic = (id? : number) =>{

    const { data: topics } = useTopics();
    return topics?.results.find((g) => g.id === id);
}

export default useTopic;