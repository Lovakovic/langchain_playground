import dotenv from 'dotenv';
import { EventEmitter } from 'events';
import { createMasterGraph } from './master-graph';
import type { CapturedEvent } from './nested-tracer';
import { NestedTracer } from './nested-tracer';
import type { MockFileMetadata } from './types';
import { ProcessingPhase } from './types';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { MasterGraphState } from './states';

dotenv.config();

async function runNestedTracingDemo(): Promise<typeof MasterGraphState.State> {
  console.log('🎯 Starting Nested Tracing Demo');
  console.log('='.repeat(50));

  // Create event emitter for real-time event capture
  const eventEmitter = new EventEmitter();
  const menuId = 'demo-menu-123';

  // Create our enhanced tracer
  const tracer = new NestedTracer(eventEmitter, menuId);

  // Set up real-time event logging
  eventEmitter.on('processingEvent', (_menuId: string, event: CapturedEvent) => {
    const levelIndent = '  '.repeat(event.graphLevel || 0);

    console.log(`${levelIndent}[${event.type}] ${event.phase}: ${event.message}`);

    if (event.type === 'tool:end') {
      console.log(`${levelIndent}  🔧 Tool: ${event.metadata?.['toolName']}`);
      console.log(`${levelIndent}  📍 Node: ${event.metadata?.['currentNode']}`);
      console.log(`${levelIndent}  🏗️  Master: ${event.metadata?.['masterGraphNode']}`);
      console.log(`${levelIndent}  🔗 Subgraph: ${event.metadata?.['subgraphNode'] || 'direct'}`);
      console.log(`${levelIndent}  📊 Path: ${event.executionPath?.join(' -> ')}`);
    }

    if (event.type === 'custom:event') {
      console.log(`${levelIndent}  📢 Custom Event: ${event.metadata?.['eventName']}`);
      console.log(`${levelIndent}  📍 Node: ${event.metadata?.['currentNode']}`);
      console.log(`${levelIndent}  🏗️  Master: ${event.metadata?.['masterGraphNode']}`);
      console.log(`${levelIndent}  🔗 Subgraph: ${event.metadata?.['subgraphNode'] || 'direct'}`);
      console.log(`${levelIndent}  📊 Path: ${event.executionPath?.join(' -> ')}`);

      // Show interesting custom event data
      if (event.metadata?.['eventData']) {
        const data = event.metadata['eventData'];
        if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
          const keys = Object.keys(data).slice(0, 3); // Show first 3 keys
          if (keys.length > 0) {
            console.log(
              `${levelIndent}  📋 Data: ${keys.map((k) => `${k}=${(data as Record<string, unknown>)[k]}`).join(', ')}`,
            );
          }
        }
      }
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
      `,
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
      `,
    },
  ];

  // Create the master graph
  const masterGraph = createMasterGraph();

  // Configure with tracer
  const config: RunnableConfig = {
    callbacks: [tracer],
    metadata: {
      menuId,
      demo: true,
    },
  };

  try {
    console.log('\n🚀 Executing master graph with nested subgraphs...\n');

    // Execute the graph
    const result = await masterGraph.invoke(
      {
        inputFiles,
        menuId,
      },
      config,
    );

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
    console.log(`\n${'='.repeat(60)}`);
    console.log('📈 TRACING ANALYSIS');
    console.log('='.repeat(60));

    const summary = tracer.getExecutionSummary();
    console.log(summary);

    // Detailed tool call analysis
    console.log('\n🔧 DETAILED TOOL CALL ANALYSIS:');
    const toolCallEvents = tracer.getToolCallEvents();

    toolCallEvents.forEach((event, index) => {
      console.log(`\n${index + 1}. Tool Call: ${event.metadata?.['toolName']}`);
      console.log(`   ├─ Executed in node: ${event.metadata?.['currentNode']}`);
      console.log(`   ├─ Master graph node: ${event.metadata?.['masterGraphNode']}`);
      console.log(
        `   ├─ Subgraph node: ${event.metadata?.['subgraphNode'] || 'N/A (direct execution)'}`,
      );
      console.log(`   ├─ Graph level: ${event.graphLevel}`);
      console.log(`   ├─ Execution path: ${event.executionPath?.join(' -> ')}`);
      console.log(`   ├─ Model: ${event.metadata?.['modelName']}`);
      console.log(`   └─ Tool ID: ${event.metadata?.['toolCallId']}`);
    });

    // Custom events analysis
    console.log('\n📢 CUSTOM EVENTS ANALYSIS:');
    const customEvents = tracer.getCustomEvents();

    if (customEvents.length > 0) {
      // Group custom events by type for analysis
      const eventsByType = customEvents.reduce(
        (acc, event) => {
          const eventName =
            typeof event.metadata?.['eventName'] === 'string'
              ? event.metadata['eventName']
              : 'unknown';
          if (!acc[eventName]) {
            acc[eventName] = [];
          }
          acc[eventName].push(event);
          return acc;
        },
        {} as Record<string, typeof customEvents>,
      );

      console.log(`\nTotal custom events captured: ${customEvents.length}\n`);

      // Show event types and counts
      Object.entries(eventsByType).forEach(([eventName, events]) => {
        console.log(`📊 ${eventName}: ${events.length} events`);

        // Show hierarchy distribution for this event type
        const hierarchyStats = events.reduce(
          (acc, event) => {
            const path = event.executionPath?.join(' -> ') || 'unknown';
            acc[path] = (acc[path] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );

        Object.entries(hierarchyStats).forEach(([path, count]) => {
          console.log(`   └─ ${path}: ${count} events`);
        });
      });

      // Show timeline of key business events
      console.log('\n⏱️  BUSINESS EVENT TIMELINE:');
      const businessEvents = customEvents
        .filter((event) => {
          const eventName = event.metadata?.['eventName'];
          return (
            typeof eventName === 'string' &&
            [
              'analysis_started',
              'analysis_completed',
              'enrichment_started',
              'enrichment_completed',
              'subgraph_entered',
              'subgraph_exited',
            ].includes(eventName)
          );
        })
        .sort((a, b) => a.timestamp - b.timestamp);

      const firstEventTimestamp = businessEvents[0]?.timestamp ?? 0;
      businessEvents.forEach((event, index) => {
        const timeOffset = index === 0 ? '0ms' : `+${event.timestamp - firstEventTimestamp}ms`;
        const indent = '  '.repeat(event.graphLevel || 0);
        console.log(
          `${indent}${timeOffset} - ${event.metadata?.['eventName']} (${event.executionPath?.join(' -> ') || 'unknown'})`,
        );
      });

      // Performance insights from custom events
      console.log('\n⚡ PERFORMANCE INSIGHTS FROM CUSTOM EVENTS:');
      const performanceEvents = customEvents.filter(
        (event) => event.metadata?.['performanceMetrics'] || event.metadata?.['duration'],
      );

      if (performanceEvents.length > 0) {
        performanceEvents.forEach((event) => {
          const metrics = event.metadata?.['performanceMetrics'];
          const duration = event.metadata?.['duration'];
          const node =
            typeof event.metadata?.['currentNode'] === 'string'
              ? event.metadata['currentNode']
              : event.nodeName;

          if (
            metrics &&
            typeof metrics === 'object' &&
            metrics !== null &&
            'totalDuration' in metrics &&
            'llmDuration' in metrics &&
            'processingRate' in metrics &&
            'averageTimePerItem' in metrics
          ) {
            console.log(`   ${node}:`);
            console.log(`     ├─ Total duration: ${metrics['totalDuration']}ms`);
            console.log(`     ├─ LLM duration: ${metrics['llmDuration']}ms`);
            console.log(
              `     ├─ Processing rate: ${(metrics['processingRate'] as number).toFixed(2)} items/sec`,
            );
            console.log(
              `     └─ Avg time per item: ${(metrics['averageTimePerItem'] as number).toFixed(2)}ms`,
            );
          } else if (typeof duration === 'number') {
            console.log(`   ${node}: ${duration}ms`);
          }
        });
      }

      // Error analysis from custom events
      console.log('\n🚨 ERROR ANALYSIS FROM CUSTOM EVENTS:');
      const errorEvents = customEvents.filter(
        (event) =>
          event.metadata?.['eventName'] === 'validation_failed' || event.metadata?.['error'],
      );

      if (errorEvents.length > 0) {
        errorEvents.forEach((event) => {
          console.log(`   ❌ ${event.metadata?.['error'] || 'Unknown error'}`);
          console.log(`      └─ Location: ${event.executionPath?.join(' -> ') || 'unknown'}`);
        });
      } else {
        console.log('   ✅ No errors detected in custom events');
      }
    } else {
      console.log('No custom events captured.');
    }

    // Phase breakdown
    console.log('\n📊 PHASE BREAKDOWN:');
    const phases = Object.values(ProcessingPhase);
    phases.forEach((phase) => {
      const phaseEvents = tracer.getEventsByPhase(phase);
      const startEvents = phaseEvents.filter((e) => e.type === 'phase:start');
      const toolEvents = phaseEvents.filter((e) => e.type === 'tool:end');

      if (startEvents.length > 0) {
        console.log(
          `   ${phase}: ${startEvents.length} operations, ${toolEvents.length} tool calls`,
        );
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
    events.forEach((event) => {
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
