import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";

export async function GET({ params }) {
	const id = params.id;
	const assistantId = new ObjectId(id);

	const assistant = await collections.assistants.findOne({
		_id: assistantId,
	});

	if (assistant) {
		const response = {
			...assistant,
			apiKey: assistant.apiKey ?? undefined,
			apiUrl: assistant.apiUrl ?? undefined,
		};
		return Response.json(response);
	} else {
		return Response.json({ message: "Assistant not found" }, { status: 404 });
	}
}
