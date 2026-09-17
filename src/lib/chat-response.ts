const TEMPORARY_RESPONSE =
  "Сообщение принято. Подключение базы знаний и ИИ будет добавлено на следующем этапе.";

export async function getAssistantResponse(message: string): Promise<string> {
  if (!message.trim()) {
    throw new Error("Сообщение не может быть пустым.");
  }

  return TEMPORARY_RESPONSE;
}
