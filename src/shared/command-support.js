export async function getExtensionCommands(commandsApi) {
  if (typeof commandsApi?.getAll !== "function") {
    return [];
  }

  try {
    return await commandsApi.getAll();
  } catch {
    return [];
  }
}
