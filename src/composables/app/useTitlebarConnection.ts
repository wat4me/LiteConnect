import { ref } from 'vue'

/** Shared label for database mode titlebar center (set by DB workspace). */
const dbConnectionLabel = ref('')

export function useTitlebarConnection() {
  function setDbConnectionLabel(label: string) {
    dbConnectionLabel.value = label
  }

  return {
    dbConnectionLabel,
    setDbConnectionLabel,
  }
}
