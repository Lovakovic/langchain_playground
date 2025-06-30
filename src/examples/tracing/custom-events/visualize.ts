/**
 * Custom Events Log Visualizer
 * 
 * This script analyzes and visualizes custom event logs created by the main example.
 * It shows:
 * - The complete run hierarchy tree
 * - Custom events attached to each run
 * - Timeline of events
 * - Statistics and insights
 * 
 * Usage:
 *   npx ts-node visualize.ts                    # Analyzes the most recent log
 *   npx ts-node visualize.ts <filename>         # Analyzes a specific log file
 *   npx ts-node visualize.ts --stats            # Shows only statistics
 *   npx ts-node visualize.ts --timeline         # Shows timeline view
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

interface CustomEvent {
  timestamp: string;
  eventName: string;
  runId: string;
  hierarchy: string[];
  depth: number;
  data: any;
  tags?: string[];
  metadata?: Record<string, any>;
}

interface RunNode {
  runId: string;
  name: string;
  events: CustomEvent[];
  children: RunNode[];
  firstEventTime?: Date;
  lastEventTime?: Date;
}

/**
 * Parse a JSONL log file containing custom events
 */
async function parseLogFile(logPath: string): Promise<CustomEvent[]> {
  const events: CustomEvent[] = [];
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.trim()) {
      try {
        const event = JSON.parse(line);
        events.push(event);
      } catch (e) {
        console.error("Failed to parse line:", line);
      }
    }
  }

  return events;
}

/**
 * Build a hierarchical tree structure from events
 */
function buildRunTree(events: CustomEvent[]): Map<string, RunNode> {
  const runMap = new Map<string, RunNode>();
  const rootRuns = new Set<string>();
  
  // First pass: Create all run nodes
  events.forEach(event => {
    if (!runMap.has(event.runId)) {
      runMap.set(event.runId, {
        runId: event.runId,
        name: event.hierarchy[event.hierarchy.length - 1] || "unnamed",
        events: [],
        children: []
      });
    }
    
    const node = runMap.get(event.runId)!;
    node.events.push(event);
    
    // Update time bounds
    const eventTime = new Date(event.timestamp);
    if (!node.firstEventTime || eventTime < node.firstEventTime) {
      node.firstEventTime = eventTime;
    }
    if (!node.lastEventTime || eventTime > node.lastEventTime) {
      node.lastEventTime = eventTime;
    }
  });
  
  // Second pass: Build parent-child relationships based on hierarchy
  runMap.forEach((node, runId) => {
    const event = node.events[0];
    if (event && event.hierarchy.length > 1) {
      // Find potential parent by matching hierarchy prefix
      runMap.forEach((potentialParent, parentId) => {
        if (parentId === runId) return;
        
        const parentEvent = potentialParent.events[0];
        if (parentEvent && 
            event.hierarchy.length === parentEvent.hierarchy.length + 1 &&
            event.hierarchy.slice(0, -1).every((h, i) => h === parentEvent.hierarchy[i])) {
          potentialParent.children.push(node);
          return;
        }
      });
    } else {
      rootRuns.add(runId);
    }
  });
  
  // Identify remaining roots (nodes with no parents)
  runMap.forEach((node, runId) => {
    const hasParent = Array.from(runMap.values()).some(n => 
      n.children.some(child => child.runId === runId)
    );
    if (!hasParent) {
      rootRuns.add(runId);
    }
  });
  
  // Return only root nodes for clean tree structure
  const rootMap = new Map<string, RunNode>();
  rootRuns.forEach(runId => {
    const node = runMap.get(runId);
    if (node) {
      rootMap.set(runId, node);
    }
  });
  
  return rootMap;
}

/**
 * Print the run tree with custom events
 */
function printRunTree(node: RunNode, indent: string = "", isLast: boolean = true): void {
  const prefix = indent + (isLast ? "└── " : "├── ");
  const runInfo = `${node.name} (${node.runId.slice(0, 8)}...)`;
  const eventCount = node.events.length;
  
  console.log(`${prefix}📦 ${runInfo} [${eventCount} event${eventCount !== 1 ? 's' : ''}]`);
  
  // Print events for this run
  const eventIndent = indent + (isLast ? "    " : "│   ");
  node.events.forEach((event, i) => {
    const isLastEvent = i === node.events.length - 1 && node.children.length === 0;
    const eventPrefix = eventIndent + (isLastEvent ? "└── " : "├── ");
    const dataPreview = typeof event.data === 'object' 
      ? Object.keys(event.data).join(", ")
      : String(event.data);
    console.log(`${eventPrefix}📢 ${event.eventName} {${dataPreview}}`);
  });
  
  // Print children
  node.children.forEach((child, i) => {
    const childIndent = indent + (isLast ? "    " : "│   ");
    printRunTree(child, childIndent, i === node.children.length - 1);
  });
}

/**
 * Print timeline view of events
 */
function printTimeline(events: CustomEvent[]): void {
  console.log("\n📅 Event Timeline:");
  console.log("=" + "=".repeat(70) + "\n");
  
  // Sort events by timestamp
  const sortedEvents = [...events].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  let lastTime: Date | null = null;
  sortedEvents.forEach(event => {
    const eventTime = new Date(event.timestamp);
    const timeStr = eventTime.toISOString().split('T')[1].slice(0, 12);
    
    // Calculate time delta
    let deltaStr = "";
    if (lastTime) {
      const delta = eventTime.getTime() - lastTime.getTime();
      deltaStr = ` (+${delta}ms)`;
    }
    lastTime = eventTime;
    
    // Create hierarchy string
    const hierarchyStr = event.hierarchy.join(" > ");
    
    console.log(`${timeStr}${deltaStr} │ ${event.eventName.padEnd(25)} │ ${hierarchyStr}`);
  });
}

/**
 * Calculate and display statistics
 */
function printStatistics(events: CustomEvent[]): void {
  console.log("\n📊 Event Statistics:");
  console.log("=" + "=".repeat(70) + "\n");
  
  // Basic counts
  console.log(`Total events: ${events.length}`);
  
  // Events by name
  const eventCounts = new Map<string, number>();
  events.forEach(event => {
    eventCounts.set(event.eventName, (eventCounts.get(event.eventName) || 0) + 1);
  });
  
  console.log("\nEvents by type:");
  Array.from(eventCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => {
      console.log(`  ${name}: ${count}`);
    });
  
  // Events by depth
  const depthCounts = new Map<number, number>();
  events.forEach(event => {
    depthCounts.set(event.depth, (depthCounts.get(event.depth) || 0) + 1);
  });
  
  console.log("\nEvents by hierarchy depth:");
  Array.from(depthCounts.entries())
    .sort((a, b) => a[0] - b[0])
    .forEach(([depth, count]) => {
      console.log(`  Depth ${depth}: ${count} events`);
    });
  
  // Time analysis
  if (events.length > 0) {
    const times = events.map(e => new Date(e.timestamp).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const duration = maxTime - minTime;
    
    console.log("\nTime analysis:");
    console.log(`  Total duration: ${duration}ms`);
    console.log(`  Average time between events: ${(duration / (events.length - 1)).toFixed(2)}ms`);
  }
  
  // Unique runs
  const uniqueRuns = new Set(events.map(e => e.runId));
  console.log(`\nUnique runs: ${uniqueRuns.size}`);
  
  // Most active runs
  const runEventCounts = new Map<string, number>();
  events.forEach(event => {
    const key = `${event.hierarchy[event.hierarchy.length - 1]} (${event.runId.slice(0, 8)}...)`;
    runEventCounts.set(key, (runEventCounts.get(key) || 0) + 1);
  });
  
  console.log("\nMost active runs:");
  Array.from(runEventCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([run, count]) => {
      console.log(`  ${run}: ${count} events`);
    });
}

/**
 * Main visualization function
 */
async function visualize(logFile: string, options: { stats?: boolean; timeline?: boolean } = {}) {
  console.log("\n🔍 Custom Event Log Visualizer");
  console.log("=" + "=".repeat(70) + "\n");
  console.log(`Analyzing: ${path.basename(logFile)}\n`);
  
  // Parse events
  const events = await parseLogFile(logFile);
  console.log(`Found ${events.length} custom events\n`);
  
  if (events.length === 0) {
    console.log("No events found in the log file.");
    return;
  }
  
  // Show statistics if requested or by default
  if (options.stats || (!options.timeline)) {
    printStatistics(events);
  }
  
  // Show timeline if requested
  if (options.timeline) {
    printTimeline(events);
  }
  
  // Show hierarchy tree by default
  if (!options.stats && !options.timeline) {
    console.log("\n🌳 Run Hierarchy Tree:");
    console.log("=" + "=".repeat(70) + "\n");
    
    const rootNodes = buildRunTree(events);
    
    Array.from(rootNodes.values()).forEach((node, i) => {
      printRunTree(node);
      if (i < rootNodes.size - 1) console.log();
    });
  }
}

/**
 * Find the most recent log file
 */
function findLatestLogFile(): string | null {
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) {
    return null;
  }
  
  const files = fs.readdirSync(logsDir)
    .filter(f => f.startsWith('custom-events-') && f.endsWith('.jsonl'))
    .map(f => ({
      name: f,
      path: path.join(logsDir, f),
      mtime: fs.statSync(path.join(logsDir, f)).mtime
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  
  return files.length > 0 ? files[0].path : null;
}

// Command line interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  // Parse options
  const options = {
    stats: args.includes('--stats'),
    timeline: args.includes('--timeline')
  };
  
  // Remove option flags from args
  const fileArgs = args.filter(arg => !arg.startsWith('--'));
  
  // Determine log file
  let logFile: string;
  
  if (fileArgs.length > 0) {
    // Specific file provided
    const providedFile = fileArgs[0];
    if (path.isAbsolute(providedFile)) {
      logFile = providedFile;
    } else if (providedFile.includes('/')) {
      logFile = path.resolve(providedFile);
    } else {
      // Just filename, assume it's in logs directory
      logFile = path.join(__dirname, 'logs', providedFile);
    }
    
    if (!fs.existsSync(logFile)) {
      console.error(`Error: Log file not found: ${logFile}`);
      process.exit(1);
    }
  } else {
    // Find most recent log
    const latestLog = findLatestLogFile();
    if (!latestLog) {
      console.error("Error: No log files found. Run the main example first.");
      console.error("Usage: npx ts-node visualize.ts [logfile] [--stats] [--timeline]");
      process.exit(1);
    }
    logFile = latestLog;
  }
  
  // Run visualization
  visualize(logFile, options).catch(console.error);
}