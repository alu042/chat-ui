import type { ToolResult } from "$lib/types/Tool";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import { AbortedGenerations } from "../abortedGenerations";
import type { TextGenerationContext } from "./types";
import type { EndpointMessage } from "../endpoints/endpoints";
import { getAssistantResponse } from "./assistant"; // Import the new function

type GenerateContext = Omit<TextGenerationContext, "messages"> & { messages: EndpointMessage[] };

export async function* generate(
	{ model, endpoint, conv, messages, assistant, isContinue, promptedAt }: GenerateContext,
	toolResults: ToolResult[],
	preprompt?: string
): AsyncIterable<MessageUpdate> {
	if (assistant?.apiKey && assistant?.apiUrl) {
		// Call the new getAssistantResponse function if the assistant has an apiKey and apiUrl
		yield* getAssistantResponse(assistant.apiKey, assistant.apiUrl, messages);
		return;
	}

	for await (const output of await endpoint({
		messages,
		preprompt,
		continueMessage: isContinue,
		generateSettings: assistant?.generateSettings,
		toolResults,
	})) {
		// text generation completed
		if (output.generated_text) {
			let interrupted =
				!output.token.special && !model.parameters.stop?.includes(output.token.text);

			let text = output.generated_text.trimEnd();
			for (const stopToken of model.parameters.stop ?? []) {
				if (!text.endsWith(stopToken)) continue;

				interrupted = false;
				text = text.slice(0, text.length - stopToken.length);
			}

			yield { type: MessageUpdateType.FinalAnswer, text, interrupted };
			continue;
		}

		// ignore special tokens
		if (output.token.special) continue;

		// pass down normal token
		yield { type: MessageUpdateType.Stream, token: output.token.text };

		// abort check
		const date = AbortedGenerations.getInstance().getList().get(conv._id.toString());
		if (date && date > promptedAt) break;

		// no output check
		if (!output) break;
	}
}
