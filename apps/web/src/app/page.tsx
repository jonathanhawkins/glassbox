// "/" is the swarm command center now. The original hackathon cockpit (the simulated
// tokenizer demo with the CopilotKit chat) is parked at /hackathon.
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/swarm");
}
