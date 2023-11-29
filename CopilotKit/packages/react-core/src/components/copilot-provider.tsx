"use client";
import { FunctionCallHandler } from "ai";
import { ReactNode, useCallback, useState } from "react";
import { CopilotContext, CopilotApiConfig } from "../context/copilot-context";
import useTree from "../hooks/use-tree";
import { AnnotatedFunction } from "../types/annotated-function";
import { ChatCompletionCreateParams } from "openai/resources/chat";
import { DocumentPointer } from "../types";
import useFlatCategoryStore from "../hooks/use-flat-category-store";

/**
 * Props for the CopilotProvider when using a chat API endpoint.
 */
export interface CopilotProviderApiEndpointProps {
  /**
   * The endpoint for the chat API.
   */
  chatApiEndpoint: string;

  /**
   * The children to be rendered within the CopilotProvider.
   */
  children: ReactNode;
}

/**
 * Props for the CopilotProvider when using a CopilotApiConfig.
 */
export interface CopilotProviderApiConfigProps {
  /**
   * The configuration for the Copilot API.
   */
  chatApiConfig: CopilotApiConfig;

  /**
   * The children to be rendered within the CopilotProvider.
   */
  children: ReactNode;
}

/**
 * Props for the CopilotProvider component.
 * Can be either CopilotProviderApiEndpointProps or CopilotProviderApiConfigProps.
 */
export type CopilotProviderProps =
  | CopilotProviderApiEndpointProps
  | CopilotProviderApiConfigProps;

/**
 * The CopilotProvider component.
 * This component provides the Copilot context to its children.
 * It can be configured either with a chat API endpoint or a CopilotApiConfig.
 *
 * Example usage:
 * ```
 * <CopilotProvider chatApiEndpoint="https://api.copilot.chat">
 *    <App />
 * </CopilotProvider>
 * ```
 *
 * or
 *
 * ```
 * const copilotApiConfig = new StandardCopilotApiConfig(
 *  "https://api.copilot.chat",
 *  {},
 *  {}
 *  );
 *
 * // ...
 *
 * <CopilotProvider chatApiConfig={copilotApiConfig}>
 *    <App />
 * </CopilotProvider>
 * ```
 *
 * @param props - The props for the component.
 * @returns The CopilotProvider component.
 */
export function CopilotProvider({
  children,
  ...props
}: CopilotProviderProps): JSX.Element {
  const [entryPoints, setEntryPoints] = useState<
    Record<string, AnnotatedFunction<any[]>>
  >({});

  const { addElement, removeElement, printTree } = useTree();
  const {
    addElement: addDocument,
    removeElement: removeDocument,
    allElements: allDocuments,
  } = useFlatCategoryStore<DocumentPointer>();

  const setEntryPoint = useCallback((id: string, entryPoint: AnnotatedFunction<any[]>) => {
    setEntryPoints((prevPoints) => {
      return {
        ...prevPoints,
        [id]: entryPoint,
      };
    });
  }, []);

  const removeEntryPoint = useCallback((id: string) => {
    setEntryPoints((prevPoints) => {
      const newPoints = { ...prevPoints };
      delete newPoints[id];
      return newPoints;
    });
  }, []);

  const getContextString = useCallback(
    (documents: DocumentPointer[], categories: string[]) => {
      const documentsString = documents
        .map((document) => {
          return `${document.name} (${document.sourceApplication}):\n${document.getContents()}`;
        })
        .join("\n\n");

      const nonDocumentStrings = printTree(categories);

      return `${documentsString}\n\n${nonDocumentStrings}`;
    },
    [printTree],
  );

  const addContext = useCallback(
    (
      context: string,
      parentId?: string,
      categories: string[] = defaultCopilotContextCategories,
    ) => {
      return addElement(context, categories, parentId);
    },
    [addElement],
  );

  const removeContext = useCallback(
    (id: string) => {
      removeElement(id);
    },
    [removeElement],
  );

  const getChatCompletionFunctionDescriptions = useCallback(() => {
    return entryPointsToChatCompletionFunctions(Object.values(entryPoints));
  }, [entryPoints]);

  const getFunctionCallHandler = useCallback(() => {
    return entryPointsToFunctionCallHandler(Object.values(entryPoints));
  }, [entryPoints]);

  const getDocumentsContext = useCallback(
    (categories: string[]) => {
      return allDocuments(categories);
    },
    [allDocuments],
  );

  const addDocumentContext = useCallback(
    (documentPointer: DocumentPointer, categories: string[] = defaultCopilotContextCategories) => {
      return addDocument(documentPointer, categories);
    },
    [addDocument],
  );

  const removeDocumentContext = useCallback(
    (documentId: string) => {
      removeDocument(documentId);
    },
    [removeDocument],
  );

  let copilotApiConfig: CopilotApiConfig;
  if ("chatApiEndpoint" in props) {
    copilotApiConfig = new StandardCopilotApiConfig(
      props.chatApiEndpoint,
      {},
      {}
    );
  } else {
    copilotApiConfig = props.chatApiConfig;
  }

  return (
    <CopilotContext.Provider
      value={{
        entryPoints,
        getChatCompletionFunctionDescriptions,
        getFunctionCallHandler,
        setEntryPoint,
        removeEntryPoint,
        getContextString,
        addContext,
        removeContext,
        getDocumentsContext,
        addDocumentContext,
        removeDocumentContext,
        copilotApiConfig: copilotApiConfig,
      }}
    >
      {children}
    </CopilotContext.Provider>
  );
}

export const defaultCopilotContextCategories = ["global"];

function entryPointsToFunctionCallHandler(
  entryPoints: AnnotatedFunction<any[]>[],
): FunctionCallHandler {
  return async (chatMessages, functionCall) => {
    let entrypointsByFunctionName: Record<string, AnnotatedFunction<any[]>> = {};
    for (let entryPoint of entryPoints) {
      entrypointsByFunctionName[entryPoint.name] = entryPoint;
    }

    const entryPointFunction = entrypointsByFunctionName[functionCall.name || ""];
    if (entryPointFunction) {
      let parsedFunctionCallArguments: Record<string, any>[] = [];
      if (functionCall.arguments) {
        parsedFunctionCallArguments = JSON.parse(functionCall.arguments);
      }

      const paramsInCorrectOrder: any[] = [];
      for (let arg of entryPointFunction.argumentAnnotations) {
        paramsInCorrectOrder.push(
          parsedFunctionCallArguments[arg.name as keyof typeof parsedFunctionCallArguments],
        );
      }

      await entryPointFunction.implementation(...paramsInCorrectOrder);

      // commented out becasue for now we don't want to return anything
      // const result = await entryPointFunction.implementation(
      //   ...parsedFunctionCallArguments
      // );
      // const functionResponse: ChatRequest = {
      //   messages: [
      //     ...chatMessages,
      //     {
      //       id: nanoid(),
      //       name: functionCall.name,
      //       role: 'function' as const,
      //       content: JSON.stringify(result),
      //     },
      //   ],
      // };

      // return functionResponse;
    }
  };
}

/**
 * A standard implementation of the CopilotApiConfig interface.
 *
 * Pass in the base URL of the chat API, the headers to be sent with each request, and the body to be sent with each request.
 * The rest of the CopilotApiConfig interface is implemented by default.
 *
 */
export class StandardCopilotApiConfig implements CopilotApiConfig {
  chatApiEndpoint: string;
  headers: Record<string, string>;
  body: Record<string, any>;

  constructor(
    chatApiEndpoint: string,
    headers: Record<string, string>,
    body: Record<string, any>
  ) {
    this.chatApiEndpoint = chatApiEndpoint;
    this.headers = headers;
    this.body = body;
  }

  get chatApiEndpointV2(): string {
    return this.chatApiEndpoint + "/v2";
  }
}

function entryPointsToChatCompletionFunctions(
  entryPoints: AnnotatedFunction<any[]>[],
): ChatCompletionCreateParams.Function[] {
  return entryPoints.map(annotatedFunctionToChatCompletionFunction);
}

function annotatedFunctionToChatCompletionFunction(
  annotatedFunction: AnnotatedFunction<any[]>,
): ChatCompletionCreateParams.Function {
  // Create the parameters object based on the argumentAnnotations
  let parameters: { [key: string]: any } = {};
  for (let arg of annotatedFunction.argumentAnnotations) {
    // isolate the args we should forward inline
    let { name, required, ...forwardedArgs } = arg;
    parameters[arg.name] = forwardedArgs;
  }

  let requiredParameterNames: string[] = [];
  for (let arg of annotatedFunction.argumentAnnotations) {
    if (arg.required) {
      requiredParameterNames.push(arg.name);
    }
  }

  // Create the ChatCompletionFunctions object
  let chatCompletionFunction: ChatCompletionCreateParams.Function = {
    name: annotatedFunction.name,
    description: annotatedFunction.description,
    parameters: {
      type: "object",
      properties: parameters,
      required: requiredParameterNames,
    },
  };

  return chatCompletionFunction;
}
