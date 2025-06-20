/**
 * LangGraph Parallel Execution Example: Daily Briefing Generator
 * 
 * This example demonstrates parallel execution by creating a personalized daily briefing
 * that fetches data from multiple sources simultaneously:
 * 
 * 1. Tech News (Hacker News API)
 * 2. World News (Reddit r/worldnews)
 * 3. Weather Forecast (Open-Meteo)
 * 4. Fun Fact/Joke
 * 
 * All branches execute in parallel, then results are aggregated into a
 * personalized daily briefing with activity recommendations.
 * 
 * Key concepts:
 * - Fan-out: Single node splitting into multiple parallel branches
 * - Fan-in: Multiple branches converging into a single node
 * - Real-world API integration without authentication
 * - Error handling for network requests
 * - Performance benefits of parallel execution
 * 
 * Graph Architecture:
 * The graph uses a fan-out/fan-in pattern where extract_location fans out
 * to 4 parallel branches. LangGraph automatically detects that these nodes
 * have no dependencies on each other and runs them concurrently.
 * 
 * Type Structure:
 * - DailyBriefingStateType: The full state with all data fields
 * - DailyBriefingUpdateType: Partial updates from each node
 * - DailyBriefingNodes: Union of all node names (including "__start__")
 * - DailyBriefingGraph: The fully typed CompiledStateGraph
 */

import { Annotation, CompiledStateGraph, MemorySaver, StateDefinition, StateGraph } from "@langchain/langgraph";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ChatVertexAI } from "@langchain/google-vertexai";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

/**
 * State Definition
 * 
 * Each branch updates its own part of the state:
 * - location: User's location for weather
 * - messages: Conversation history
 * - techNews: Top tech stories from Hacker News
 * - worldNews: Top world news from Reddit
 * - weather: Weather forecast data
 * - funFact: Random fun fact or joke
 * - dailyBriefing: Final aggregated briefing
 */
const DailyBriefingState = Annotation.Root({
  location: Annotation<string>,
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  techNews: Annotation<any[]>,
  worldNews: Annotation<any[]>,
  weather: Annotation<any>,
  funFact: Annotation<string>,
  dailyBriefing: Annotation<string>
});

/**
 * Location Extraction Node
 * 
 * Extracts location from user input or uses default
 */
async function extractLocation(state: typeof DailyBriefingState.State) {
  console.log("\n📍 Extracting location...");
  
  const lastMessage = state.messages[state.messages.length - 1];
  const userInput = lastMessage.content as string;
  
  // Simple location extraction - in production, use proper geocoding
  let location = "New York";
  let lat = 40.7128;
  let lon = -74.0060;
  
  // Check for common city names in input
  const cities: Record<string, [number, number]> = {
    "zagreb": [45.8150, 15.9819],
    "london": [51.5074, -0.1278],
    "paris": [48.8566, 2.3522],
    "tokyo": [35.6762, 139.6503],
    "sydney": [-33.8688, 151.2093],
    "san francisco": [37.7749, -122.4194],
    "los angeles": [34.0522, -118.2437],
    "chicago": [41.8781, -87.6298],
    "boston": [42.3601, -71.0589],
    "seattle": [47.6062, -122.3321],
    "miami": [25.7617, -80.1918]
  };
  
  const lowerInput = userInput.toLowerCase();
  for (const [city, coords] of Object.entries(cities)) {
    if (lowerInput.includes(city)) {
      location = city.charAt(0).toUpperCase() + city.slice(1);
      [lat, lon] = coords;
      break;
    }
  }
  
  console.log(`✅ Location set to: ${location} (${lat}, ${lon})`);
  
  return {
    location: `${location}|${lat}|${lon}`,
    messages: [new AIMessage(`Preparing daily briefing for ${location}...`)]
  };
}

/**
 * Tech News Branch (Parallel)
 * 
 * Fetches top stories from Hacker News
 */
async function fetchTechNews(state: typeof DailyBriefingState.State) {
  console.log("\n💻 [Tech News] Fetching from Hacker News...");
  
  try {
    // Fetch top story IDs
    const topStoriesResponse = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const topStoryIds = await topStoriesResponse.json() as number[];
    
    // Fetch details for top 5 stories
    const storyPromises = topStoryIds.slice(0, 5).map(async (id) => {
      const response = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      return response.json();
    });
    
    const stories = await Promise.all(storyPromises);
    
    console.log("✅ [Tech News] Fetched", stories.length, "stories");
    
    return {
      techNews: stories,
      messages: [new AIMessage(`Fetched ${stories.length} top tech stories from Hacker News`)]
    };
  } catch (error) {
    console.error("❌ [Tech News] Error:", error);
    return {
      techNews: [],
      messages: [new AIMessage("Failed to fetch tech news")]
    };
  }
}

/**
 * World News Branch (Parallel)
 * 
 * Fetches news from Reddit r/worldnews
 */
async function fetchWorldNews(state: typeof DailyBriefingState.State) {
  console.log("\n🌍 [World News] Fetching from Reddit...");
  
  try {
    const response = await fetch('https://www.reddit.com/r/worldnews/hot.json?limit=5', {
      headers: {
        'User-Agent': 'LangGraph-Example/1.0'
      }
    });
    
    const data = await response.json();
    const posts = data.data.children.map((child: any) => ({
      title: child.data.title,
      score: child.data.score,
      url: child.data.url,
      num_comments: child.data.num_comments
    }));
    
    console.log("✅ [World News] Fetched", posts.length, "stories");
    
    return {
      worldNews: posts,
      messages: [new AIMessage(`Fetched ${posts.length} world news stories from Reddit`)]
    };
  } catch (error) {
    console.error("❌ [World News] Error:", error);
    return {
      worldNews: [],
      messages: [new AIMessage("Failed to fetch world news")]
    };
  }
}

/**
 * Weather Branch (Parallel)
 * 
 * Fetches weather forecast from Open-Meteo
 */
async function fetchWeather(state: typeof DailyBriefingState.State) {
  console.log("\n🌤️ [Weather] Fetching forecast...");
  
  try {
    // Extract coordinates from location
    const [city, lat, lon] = state.location.split('|');
    
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
    
    const response = await fetch(url);
    const weatherData = await response.json();
    
    console.log("✅ [Weather] Fetched forecast for", city);
    
    return {
      weather: weatherData,
      messages: [new AIMessage(`Fetched weather forecast for ${city}`)]
    };
  } catch (error) {
    console.error("❌ [Weather] Error:", error);
    return {
      weather: null,
      messages: [new AIMessage("Failed to fetch weather")]
    };
  }
}

/**
 * Fun Fact Branch (Parallel)
 * 
 * Fetches a random fun fact or joke
 */
async function fetchFunFact(state: typeof DailyBriefingState.State) {
  console.log("\n🎲 [Fun Fact] Fetching daily fun fact...");
  
  try {
    // Use a simple joke API
    const response = await fetch('https://official-joke-api.appspot.com/random_joke');
    const joke = await response.json();
    
    const funFact = `${joke.setup} ${joke.punchline}`;
    
    console.log("✅ [Fun Fact] Fetched joke");
    
    return {
      funFact: funFact,
      messages: [new AIMessage("Fetched daily joke")]
    };
  } catch (error) {
    console.error("❌ [Fun Fact] Error:", error);
    // Fallback fun facts
    const facts = [
      "Did you know? Octopuses have three hearts!",
      "Fun fact: Bananas are berries, but strawberries aren't!",
      "Did you know? A group of flamingos is called a 'flamboyance'!",
      "Fun fact: Honey never spoils. Archaeologists have found 3000-year-old honey that's still edible!"
    ];
    return {
      funFact: facts[Math.floor(Math.random() * facts.length)],
      messages: [new AIMessage("Used fallback fun fact")]
    };
  }
}

/**
 * Aggregation Node
 * 
 * Combines all parallel results into a personalized daily briefing
 */
async function createDailyBriefing(state: typeof DailyBriefingState.State) {
  console.log("\n📰 Creating personalized daily briefing...");
  
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS not set");
  }

  const model = new ChatVertexAI({
    model: 'gemini-2.5-flash',
    temperature: 0.7,
  });

  const [city] = state.location.split('|');
  
  // Get current date and time
  const now = new Date();
  const timeString = now.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: true 
  });
  const dateString = now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  const hour = now.getHours();
  
  // Determine time of day
  let timeOfDay = "day";
  if (hour >= 5 && hour < 12) timeOfDay = "morning";
  else if (hour >= 12 && hour < 17) timeOfDay = "afternoon";
  else if (hour >= 17 && hour < 21) timeOfDay = "evening";
  else timeOfDay = "night";
  
  // Format weather data
  const weatherSummary = state.weather ? `
Current: ${state.weather.current.temperature_2m}°C (feels like ${state.weather.current.apparent_temperature}°C)
Today's High/Low: ${state.weather.daily.temperature_2m_max[0]}°C / ${state.weather.daily.temperature_2m_min[0]}°C
Precipitation chance: ${state.weather.daily.precipitation_probability_max[0]}%
Wind: ${state.weather.current.wind_speed_10m} km/h
` : "Weather data unavailable";

  // Format tech news
  const techNewsSummary = state.techNews.slice(0, 3).map((story, i) => 
    `${i + 1}. ${story.title} (${story.score} points)`
  ).join('\n');

  // Format world news
  const worldNewsSummary = state.worldNews.slice(0, 3).map((post, i) => 
    `${i + 1}. ${post.title} (${post.score} upvotes, ${post.num_comments} comments)`
  ).join('\n');

  const prompt = `Create an engaging, personalized daily briefing for someone in ${city}. 

CURRENT TIME AND DATE:
- Date: ${dateString}
- Time: ${timeString}
- Time of day: ${timeOfDay}

WEATHER:
${weatherSummary}

TOP TECH NEWS:
${techNewsSummary}

WORLD NEWS:
${worldNewsSummary}

FUN FACT OF THE DAY:
${state.funFact}

Please create a briefing that:
1. Starts with a time-appropriate greeting (good morning/afternoon/evening/night based on the time)
2. References the current date and time naturally
3. Summarizes the weather and suggests time-appropriate activities
4. Highlights the most interesting tech and world news
5. Ends with the fun fact
6. Uses emojis appropriately
7. Keeps a friendly, conversational tone
8. Is concise but informative
9. If it's evening/night, focus on activities for tomorrow or winding down

Format it nicely with clear sections.`;

  const response = await model.invoke(prompt);
  const briefing = response.content as string;

  console.log("✅ Daily briefing created!");
  
  return {
    dailyBriefing: briefing,
    messages: [new AIMessage(briefing)]
  };
}

/**
 * Type definitions for the Daily Briefing Graph
 */
type DailyBriefingStateType = typeof DailyBriefingState.State;
type DailyBriefingUpdateType = {
  location?: string;
  messages?: BaseMessage[];
  techNews?: any[];
  worldNews?: any[];
  weather?: any;
  funFact?: string;
  dailyBriefing?: string;
};
type DailyBriefingNodes = 
  | "extract_location" 
  | "tech_news" 
  | "world_news" 
  | "weather_fetch" 
  | "fun_fact" 
  | "create_briefing" 
  | "__start__";

/**
 * The complete type for the Daily Briefing Graph
 * 
 * This graph demonstrates parallel execution where:
 * - extract_location fans out to 4 parallel branches
 * - All branches execute simultaneously
 * - create_briefing waits for all branches to complete (fan-in)
 */
export type DailyBriefingGraph = CompiledStateGraph<
  DailyBriefingStateType,                // State type
  DailyBriefingUpdateType,                // Update type
  DailyBriefingNodes,                     // Node names
  typeof DailyBriefingState.spec,         // Input schema
  typeof DailyBriefingState.spec,         // Output schema
  StateDefinition                         // Config schema
>;

/**
 * Create the Daily Briefing Graph
 * 
 * Graph structure:
 *        extract_location
 *              |
 *     +--------+--------+--------+
 *     |        |        |        |
 * tech_news world_news weather fun_fact  (ALL run in PARALLEL!)
 *     |        |        |        |
 *     +--------+--------+--------+
 *              |
 *        create_briefing
 *              |
 *            __end__
 */
export function createDailyBriefingGraph(): DailyBriefingGraph {
  const workflow = new StateGraph(DailyBriefingState)
    // Add all nodes
    .addNode("extract_location", extractLocation)
    .addNode("tech_news", fetchTechNews)
    .addNode("world_news", fetchWorldNews)
    .addNode("weather_fetch", fetchWeather)
    .addNode("fun_fact", fetchFunFact)
    .addNode("create_briefing", createDailyBriefing)
    
    // Start with location extraction
    .addEdge("__start__", "extract_location")
    
    // FAN-OUT: All 4 branches start from extract_location
    // These execute in PARALLEL!
    .addEdge("extract_location", "tech_news")
    .addEdge("extract_location", "world_news")
    .addEdge("extract_location", "weather_fetch")
    .addEdge("extract_location", "fun_fact")
    
    // FAN-IN: All branches must complete before briefing
    .addEdge("tech_news", "create_briefing")
    .addEdge("world_news", "create_briefing")
    .addEdge("weather_fetch", "create_briefing")
    .addEdge("fun_fact", "create_briefing")
    
    // End after briefing
    .addEdge("create_briefing", "__end__");

  const checkpointer = new MemorySaver();
  return workflow.compile({ checkpointer });
}

/**
 * Run Demo
 */
async function runDemo() {
  console.log("=== 📰 LangGraph Daily Briefing Generator ===");
  console.log("\nThis example fetches data from 4 different sources IN PARALLEL:");
  console.log("• Tech News (Hacker News)");
  console.log("• World News (Reddit)"); 
  console.log("• Weather Forecast (Open-Meteo)");
  console.log("• Fun Fact/Joke\n");
  
  const graph: DailyBriefingGraph = createDailyBriefingGraph();
  const threadId = `demo-${Date.now()}`;
  
  const testInput = "Generate my daily briefing for Zagreb";
  
  console.log("Demo input:", testInput);
  console.log("\n⚡ Starting parallel data fetching...\n");
  
  const startTime = Date.now();
  
  try {
    const result = await graph.invoke(
      {
        messages: [new HumanMessage(testInput)],
        location: ""
      },
      {
        configurable: { thread_id: threadId }
      }
    );
    
    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log("\n" + "=".repeat(60));
    console.log("📰 DAILY BRIEFING");
    console.log("=".repeat(60));
    console.log(result.dailyBriefing);
    console.log("=".repeat(60));
    
    console.log(`\n⏱️  Total execution time: ${totalTime}s`);
    console.log("✨ All 4 data sources were fetched in parallel!");
    
    // Show what data was collected
    console.log("\n📊 Data Summary:");
    console.log(`- Tech News: ${result.techNews.length} stories`);
    console.log(`- World News: ${result.worldNews.length} stories`);
    console.log(`- Weather: ${result.weather ? 'Available' : 'Not available'}`);
    console.log(`- Fun Fact: ${result.funFact ? 'Fetched' : 'Not available'}`);
    
  } catch (error) {
    console.error("Error:", error);
  }
}

/**
 * Key Benefits of This Example:
 * 
 * 1. REAL-WORLD APIS:
 *    - No authentication required
 *    - Actual useful data
 *    - Free tier friendly
 * 
 * 2. GENUINE PARALLEL BENEFIT:
 *    - 4 independent API calls
 *    - ~3 seconds if sequential
 *    - ~1 second when parallel
 * 
 * 3. PRACTICAL APPLICATION:
 *    - Daily briefing generator
 *    - Weather-based recommendations
 *    - Personalized content
 * 
 * 4. ERROR RESILIENCE:
 *    - Each branch handles failures
 *    - Graceful degradation
 *    - Fallback content
 * 
 * 5. VISUAL FEEDBACK:
 *    - See parallel execution timing
 *    - Progress indicators
 *    - Clear final output
 */

// Export for use as a module
export { DailyBriefingState };

// Run demo if this file is executed directly
if (require.main === module) {
  runDemo().catch(console.error);
}
