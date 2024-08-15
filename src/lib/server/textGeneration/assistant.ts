import { isURLLocal } from "../isURLLocal";
import { env } from "$env/dynamic/private";
import { collections } from "$lib/server/database";
import type { Assistant } from "$lib/types/Assistant";
import type { ObjectId } from "mongodb";
import { logger } from "$lib/server/logger";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";

export async function processPreprompt(preprompt: string) {
	const urlRegex = /{{\s?url=(.*?)\s?}}/g;

	for (const match of preprompt.matchAll(urlRegex)) {
		try {
			const url = new URL(match[1]);
			if ((await isURLLocal(url)) && env.ENABLE_LOCAL_FETCH !== "true") {
				throw new Error("URL couldn't be fetched, it resolved to a local address.");
			}

			const res = await fetch(url.href);

			if (!res.ok) {
				throw new Error("URL couldn't be fetched, error " + res.status);
			}
			const text = await res.text();
			preprompt = preprompt.replaceAll(match[0], text);
		} catch (e) {
			preprompt = preprompt.replaceAll(match[0], (e as Error).message);
		}
	}

	return preprompt;
}

export async function getAssistantById(id?: ObjectId) {
	return collections.assistants
		.findOne<Pick<Assistant, "rag" | "dynamicPrompt" | "generateSettings" | "apiKey" | "apiUrl">>(
			{ _id: id },
			{ projection: { rag: 1, dynamicPrompt: 1, generateSettings: 1, apiKey: 1, apiUrl: 1 } }
		)
		.then((a) => a ?? undefined);
}

export function assistantHasWebSearch(assistant?: Pick<Assistant, "rag"> | null) {
	return (
		env.ENABLE_ASSISTANTS_RAG === "true" &&
		!!assistant?.rag &&
		(assistant.rag.allowedLinks.length > 0 ||
			assistant.rag.allowedDomains.length > 0 ||
			assistant.rag.allowAllDomains)
	);
}

export function assistantHasDynamicPrompt(assistant?: Pick<Assistant, "dynamicPrompt">) {
	return env.ENABLE_ASSISTANTS_RAG === "true" && Boolean(assistant?.dynamicPrompt);
}

export async function* getAssistantResponse(
	apiKey: string,
	apiUrl: string,
	messages: { role: string; content: string }[]
): AsyncGenerator<MessageUpdate> {
	try {
		const response = await fetch(apiUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"api-key": apiKey,
			},
			body: JSON.stringify({ messages }),
		});

		if (!response.ok) {
			throw new Error(`Error from API: ${response.statusText}`);
		}

		const data = await response.json();

		for (const message of data.messages) {
			yield { type: MessageUpdateType.Stream, token: message.content };
		}

		yield { type: MessageUpdateType.FinalAnswer, text: data.finalText, interrupted: false };
	} catch (error) {
		logger.error(error, "Failed to get response from assistant API");
		yield { type: MessageUpdateType.Error, message: "Failed to get response from assistant API" };
	}
}
