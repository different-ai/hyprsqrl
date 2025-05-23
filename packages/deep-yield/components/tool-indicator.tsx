import { cva } from 'class-variance-authority';
import { motion } from 'framer-motion';
import {
  FileIcon,
  SparklesIcon,
  TerminalIcon,
  BoxIcon,
  ArrowUpIcon,
  GlobeIcon,
  CodeIcon,
} from './icons';
import {
  SearchIcon,
  ChartBarIcon,
  DollarSignIcon,
  Database as DatabaseIcon,
  BarChart as BarChartIcon,
  Coins as CoinsIcon,
  LayoutDashboard as LayoutDashboardIcon,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

interface ToolIndicatorProps {
  toolName: string;
  state: 'partial-call' | 'call' | 'result';
  animate?: boolean;
}

// Define tool-specific styles and icons
const toolVariants = cva(
  'flex items-center gap-2 text-xs font-medium rounded-full py-1 px-3 border',
  {
    variants: {
      tool: {
        planYieldResearch: 'bg-purple-100 text-purple-800 border-purple-200',
        yieldSearch: 'bg-blue-100 text-blue-800 border-blue-200',
        getTokenPrice: 'bg-green-100 text-green-800 border-green-200',
        getSwapEstimate: 'bg-amber-100 text-amber-800 border-amber-200',
        getBridgeQuote: 'bg-pink-100 text-pink-800 border-pink-200',
        getTokenInfo: 'bg-cyan-100 text-cyan-800 border-cyan-200',
        getWeather: 'bg-sky-100 text-sky-800 border-sky-200',
        getProtocolTvl: 'bg-orange-100 text-orange-800 border-orange-200',
        getChainTvl: 'bg-teal-100 text-teal-800 border-teal-200',
        getProtocolFees: 'bg-lime-100 text-lime-800 border-lime-200',
        deepSearch: 'bg-violet-100 text-violet-800 border-violet-200',
        createDocument: 'bg-indigo-100 text-indigo-800 border-indigo-200',
        updateDocument: 'bg-purple-100 text-purple-800 border-purple-200',
        requestSuggestions: 'bg-rose-100 text-rose-800 border-rose-200',
        default: 'bg-gray-100 text-gray-800 border-gray-200',
      },
      state: {
        'partial-call': 'opacity-60',
        call: 'opacity-90',
        result: 'opacity-100',
      },
    },
    defaultVariants: {
      tool: 'default',
      state: 'call',
    },
  },
);

// Component to display the appropriate icon for each tool
const ToolIcon = ({ toolName }: { toolName: string }) => {
  switch (toolName) {
    case 'planYieldResearch':
      return <SearchIcon className="size-4" />;
    case 'yieldSearch':
      return <ChartBarIcon className="size-4" />;
    case 'getTokenPrice':
      return <DollarSignIcon className="size-4" />;
    case 'getSwapEstimate':
      return <ArrowUpIcon size={14} />;
    case 'getTokenInfo':
      return <DatabaseIcon size={14} />;
    case 'getBridgeQuote':
      return <ArrowUpIcon size={14} />;
    case 'getWeather':
      return <GlobeIcon size={14} />;
    case 'getProtocolTvl':
      return <BarChartIcon size={14} />;
    case 'getChainTvl':
      return <DatabaseIcon size={14} />;
    case 'getProtocolFees':
      return <CoinsIcon size={14} />;
    case 'deepSearch':
      return <LayoutDashboardIcon size={14} />;
    case 'createDocument':
    case 'updateDocument':
      return <FileIcon size={14} />;
    case 'requestSuggestions':
      return <TerminalIcon size={14} />;
    default:
      return <SparklesIcon size={14} />;
  }
};

// User-friendly descriptions for each tool
const getToolDescription = (toolName: string): string => {
  switch (toolName) {
    case 'planYieldResearch':
      return 'Creating a research plan for yield opportunities';
    case 'yieldSearch':
      return 'Searching for yield farming opportunities';
    case 'getTokenPrice':
      return 'Retrieving token price information';
    case 'getSwapEstimate':
      return 'Calculating token swap estimates (same chain)';
    case 'getTokenInfo':
      return 'Finding token contract address and details on a specific blockchain';
    case 'getBridgeQuote':
      return 'Estimating costs for moving tokens between blockchains';
    case 'getWeather':
      return 'Checking weather information';
    case 'getProtocolTvl':
      return 'Fetching Total Value Locked for a DeFi protocol';
    case 'getChainTvl':
      return 'Fetching Total Value Locked for a blockchain';
    case 'getProtocolFees':
      return 'Retrieving fee and revenue data for a protocol';
    case 'deepSearch':
      return 'Comprehensive search across DeFi protocols, yields, TVL and fees';
    case 'createDocument':
      return 'Creating a new document';
    case 'updateDocument':
      return 'Updating an existing document';
    case 'requestSuggestions':
      return 'Generating suggestions';
    default:
      return 'Using a tool';
  }
};

// Main component
export const ToolIndicator = ({
  toolName,
  state,
  animate = true,
}: ToolIndicatorProps) => {
  // Status text changes based on state
  const statusText =
    state === 'partial-call'
      ? 'Preparing...'
      : state === 'call'
        ? 'Processing...'
        : 'Complete';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.div
          className={toolVariants({ tool: toolName as any, state })}
          initial={animate ? { opacity: 0, y: 5 } : undefined}
          animate={animate ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.2 }}
        >
          <ToolIcon toolName={toolName} />
          <span className="whitespace-nowrap">
            {toolName} • <span className="italic">{statusText}</span>
          </span>
        </motion.div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{getToolDescription(toolName)}</p>
      </TooltipContent>
    </Tooltip>
  );
};

// Component to display a list of tool indicators
export const ToolIndicatorGroup = ({
  toolInvocations,
}: {
  toolInvocations: Array<{
    toolName: string;
    state: 'partial-call' | 'call' | 'result';
    toolCallId: string;
  }>;
}) => {
  if (!toolInvocations || toolInvocations.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {toolInvocations.map((invocation) => (
        <ToolIndicator
          key={invocation.toolCallId}
          toolName={invocation.toolName}
          state={invocation.state}
        />
      ))}
    </div>
  );
};
