import dotenv from 'dotenv';
import { EventEmitter } from 'events';
import { createMasterGraph } from './master-graph';
import { NestedTracer } from './nested-tracer';
import { MockFileMetadata, ProcessingPhase } from './types';
import { RunnableConfig } from '@langchain/core/runnables';

dotenv.config();

async function runNestedTracingDemo() {
  console.log('🎯 Starting Nested Tracing Demo');
  console.log('='.repeat(50));

  // Create event emitter for real-time event capture
  const eventEmitter = new EventEmitter();
  const menuId = 'demo-menu-123';

  // Create our enhanced tracer
  const tracer = new NestedTracer(eventEmitter, menuId);

  // Set up real-time event logging
  eventEmitter.on('processingEvent', (menuId: string, event: any) => {
    const levelIndent = '  '.repeat(event.graphLevel || 0);
    const nodeInfo = event.parentNodeName ? 
      `${event.parentNodeName} -> ${event.nodeName}` : 
      event.nodeName;
    
    console.log(`${levelIndent}[${event.type}] ${event.phase}: ${event.message}`);
    
    if (event.type === 'tool:end') {
      console.log(`${levelIndent}  🔧 Tool: ${event.metadata?.toolName}`);
      console.log(`${levelIndent}  📍 Node: ${event.metadata?.currentNode}`);
      console.log(`${levelIndent}  🏗️  Master: ${event.metadata?.masterGraphNode}`);
      console.log(`${levelIndent}  🔗 Subgraph: ${event.metadata?.subgraphNode || 'direct'}`);
      console.log(`${levelIndent}  📊 Path: ${event.executionPath?.join(' -> ')}`);
    }
  });

  // Create test input data
  const inputFiles: MockFileMetadata[] = [
    {
      fileId: 'file-1',
      fileName: 'sample-menu.pdf',
      content: `
PIZZA MENU
---------
1. Margherita Pizza - Fresh tomatoes, mozzarella, basil - €12.50
2. Pepperoni Pizza - Pepperoni, mozzarella, tomato sauce - €14.00

BEVERAGES
---------
1. Cola - €3.50
2. Water - €2.00
3. Beer - €4.50

DESSERTS
--------
1. Tiramisu - Traditional Italian dessert - €6.00
2. Gelato - Various flavors - €4.50
      `
    },
    {
      fileId: 'file-2', 
      fileName: 'allergen-info.pdf',
      content: `
ALLERGEN INFORMATION
-------------------
Pizza contains: Gluten, Dairy
Tiramisu contains: Eggs, Dairy, Gluten
Beer contains: Gluten
      `
    }
  ];

  // Create the master graph
  const masterGraph = createMasterGraph();

  // Configure with tracer
  const config: RunnableConfig = {
    callbacks: [tracer],
    metadata: { 
      menuId,
      demo: true
    }
  };

  try {
    console.log('\n🚀 Executing master graph with nested subgraphs...\n');

    // Execute the graph
    const result = await masterGraph.invoke({
      inputFiles,
      menuId,
    }, config);

    console.log('\n✅ Execution completed successfully!');
    console.log('\n📊 RESULTS:');
    console.log(`   Menu ID: ${result.menuId}`);
    console.log(`   Extracted Items: ${result.extractedItems?.length || 0}`);
    console.log(`   Menu Sections: ${result.menuStructure?.length || 0}`);
    console.log(`   Category Enrichments: ${result.categorizedItems?.length || 0}`);
    console.log(`   Allergen Analysis: ${result.allergenInfo?.length || 0}`);
    console.log(`   Translations: ${result.translatedItems?.length || 0}`);
    console.log(`   Completeness Score: ${result.completenessScore || 0}%`);

    // Analyze captured events
    console.log('\n' + '='.repeat(60));
    console.log('📈 TRACING ANALYSIS');
    console.log('='.repeat(60));
    
    const summary = tracer.getExecutionSummary();
    console.log(summary);

    // Detailed tool call analysis
    console.log('\n🔧 DETAILED TOOL CALL ANALYSIS:');
    const toolCallEvents = tracer.getToolCallEvents();
    
    toolCallEvents.forEach((event, index) => {
      console.log(`\n${index + 1}. Tool Call: ${event.metadata?.toolName}`);
      console.log(`   ├─ Executed in node: ${event.metadata?.currentNode}`);
      console.log(`   ├─ Master graph node: ${event.metadata?.masterGraphNode}`);
      console.log(`   ├─ Subgraph node: ${event.metadata?.subgraphNode || 'N/A (direct execution)'}`);
      console.log(`   ├─ Graph level: ${event.graphLevel}`);
      console.log(`   ├─ Execution path: ${event.executionPath?.join(' -> ')}`);
      console.log(`   ├─ Model: ${event.metadata?.modelName}`);
      console.log(`   └─ Tool ID: ${event.metadata?.toolCallId}`);
    });

    // Phase breakdown
    console.log('\n📊 PHASE BREAKDOWN:');
    const phases = Object.values(ProcessingPhase);
    phases.forEach(phase => {
      const phaseEvents = tracer.getEventsByPhase(phase);
      const startEvents = phaseEvents.filter(e => e.type === 'phase:start');
      const endEvents = phaseEvents.filter(e => e.type === 'phase:end');
      const toolEvents = phaseEvents.filter(e => e.type === 'tool:end');
      
      if (startEvents.length > 0) {
        console.log(`   ${phase}: ${startEvents.length} operations, ${toolEvents.length} tool calls`);
      }
    });

    // Token usage summary
    const tokenUsage = tracer.getTokenUsage();
    console.log('\n💰 TOKEN USAGE SUMMARY:');
    console.log(`   Input tokens: ${tokenUsage.input}`);
    console.log(`   Output tokens: ${tokenUsage.output}`);
    console.log(`   Total tokens: ${tokenUsage.total}`);

    return result;

  } catch (error) {
    console.error('\n❌ Execution failed:', error);
    
    // Still show captured events for debugging
    console.log('\n🔍 CAPTURED EVENTS (up to failure):');
    const events = tracer.getCapturedEvents();
    events.forEach(event => {
      console.log(`   [${event.type}] ${event.nodeName}: ${event.message}`);
    });
    
    throw error;
  }
}

// Run the demo
if (require.main === module) {
  runNestedTracingDemo()
    .then(() => {
      console.log('\n🎉 Demo completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Demo failed:', error);
      process.exit(1);
    });
}

export { runNestedTracingDemo };