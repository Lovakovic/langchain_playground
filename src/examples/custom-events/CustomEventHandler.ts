import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import * as fs from "fs";

/**
 * CustomEventHandler - A callback handler specifically for logging custom events
 * 
 * This handler extends BaseCallbackHandler to capture custom events dispatched
 * during LangChain/LangGraph execution and writes them to a log file.
 * 
 * Events are logged as raw JSON objects, one per line, making it easy to parse
 * and process the log file programmatically.
 */
export class CustomEventHandler extends BaseCallbackHandler {
  name = "custom_event_handler" as const;
  
  private logStream: fs.WriteStream;

  constructor(logFilePath: string) {
    super();
    this.logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  }

  /**
   * Handle custom events - this is the main method that captures custom events
   * 
   * @param eventName - The name of the custom event (defined when dispatching)
   * @param data - The data payload of the custom event
   * @param runId - The run ID of the current execution context
   * @param tags - Any tags associated with the run
   * @param metadata - Any metadata associated with the run
   */
  async handleCustomEvent(
    eventName: string,
    data: any,
    runId: string,
    tags?: string[],
    metadata?: Record<string, any>
  ): Promise<any> {
    // Create event object
    const event = {
      timestamp: new Date().toISOString(),
      eventName,
      runId,
      data,
      ...(tags && tags.length > 0 && { tags }),
      ...(metadata && Object.keys(metadata).length > 0 && { metadata })
    };
    
    // Write as JSON line
    this.logStream.write(JSON.stringify(event) + '\n');
    
    // Log to console for immediate feedback
    console.log(`📢 Custom Event: ${eventName}`);
    if (typeof data === 'object') {
      console.log(`   Data:`, JSON.stringify(data, null, 2));
    } else {
      console.log(`   Data:`, data);
    }
  }

  /**
   * Close the log file
   */
  close() {
    this.logStream.end();
  }
}