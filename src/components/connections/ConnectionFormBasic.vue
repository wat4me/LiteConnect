<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'
import type { Group, SavedCredential } from '../../env.d.ts'
import { CONNECTION_COLOR_TAGS } from '@/utils/connections/connectionTags'
import type { ConnectionFormModel } from './connectionFormTypes'

defineProps<{
  form: ConnectionFormModel
  groups: Group[]
  savedCredentials: SavedCredential[]
  selectedCredentialId: string
  authType: 'password' | 'key'
  showPassword: boolean
  privateKeyFileName: string
  keepStoredPrivateKey: boolean
}>()

const emit = defineEmits<{
  (e: 'update:selectedCredentialId', value: string): void
  (e: 'update:showPassword', value: boolean): void
  (e: 'apply-credential'): void
  (e: 'switch-auth', type: 'password' | 'key'): void
  (e: 'select-private-key'): void
  (e: 'clear-private-key'): void
}>()

const { t } = useI18n()
const nameInputRef = ref<HTMLInputElement | null>(null)
defineExpose({ nameInputRef })
</script>

<template>
  <div class="form-section">
    <div class="form-row">
      <label class="label">{{ t('connectionForm.name') }}</label>
      <input
        ref="nameInputRef"
        v-model="form.name"
        :placeholder="t('connectionForm.namePlaceholder')"
        class="ui-input"
      />
    </div>

    <div class="form-row">
      <label class="label">{{ t('connectionForm.host') }}</label>
      <div class="host-row">
        <input v-model="form.host" :placeholder="t('connectionForm.hostPlaceholder')" class="ui-input host-input" />
        <input v-model.number="form.port" type="number" :placeholder="t('connectionForm.port')" class="ui-input port-input" />
      </div>
    </div>

    <div class="form-row">
      <label class="label">{{ t('connectionForm.username') }}</label>
      <div class="username-row">
        <input v-model="form.username" placeholder="root" class="ui-input username-input" />
        <select
          :value="selectedCredentialId"
          class="ui-select credential-inline-select"
          :title="t('connectionForm.credentialSelectTitle')"
          @change="emit('update:selectedCredentialId', ($event.target as HTMLSelectElement).value); emit('apply-credential')"
        >
          <option value="">{{ t('connectionForm.selectCredential') }}</option>
          <option v-for="credential in savedCredentials" :key="credential.id" :value="credential.id">
            {{ credential.name }} / {{ credential.username }}
          </option>
        </select>
      </div>
    </div>

    <div class="form-row">
      <label class="label">{{ t('connectionForm.authType') }}</label>
      <div class="auth-tabs">
        <button type="button" class="auth-tab" :class="{ active: authType === 'password' }" @click="emit('switch-auth', 'password')">{{ t('connectionForm.password') }}</button>
        <button type="button" class="auth-tab" :class="{ active: authType === 'key' }" @click="emit('switch-auth', 'key')">{{ t('connectionForm.key') }}</button>
      </div>
    </div>

    <div v-if="authType === 'password'" class="form-row">
      <label class="label">{{ t('connectionForm.password') }}</label>
      <div class="password-row">
        <input v-model="form.password" :type="showPassword ? 'text' : 'password'" :placeholder="t('connectionForm.passwordPlaceholder')" class="ui-input password-input" />
        <button type="button" class="btn-toggle-password" @click="emit('update:showPassword', !showPassword)" :title="showPassword ? t('connectionForm.hidePassword') : t('connectionForm.showPassword')">
          <AppIcon :name="showPassword ? 'eye-off' : 'eye'" size="md" />
        </button>
      </div>
    </div>

    <div v-if="authType === 'key'" class="form-row">
      <label class="label">{{ t('connectionForm.privateKey') }}</label>
      <div class="privatekey-row">
        <button type="button" class="btn-select-key" @click="emit('select-private-key')">{{ privateKeyFileName || t('connectionForm.selectPrivateKey') }}</button>
        <button v-if="form.privateKey || keepStoredPrivateKey" type="button" class="btn-clear-key" @click="emit('clear-private-key')" :title="t('connectionForm.clearPrivateKey')">
          <AppIcon name="close" size="sm" />
        </button>
      </div>
      <div class="hint-text">{{ t('connectionForm.privateKeyHint') }}</div>
      <div class="form-row nested-row">
        <label class="label">{{ t('connectionForm.passphrase') }}</label>
        <div class="password-row">
          <input v-model="form.password" :type="showPassword ? 'text' : 'password'" :placeholder="t('connectionForm.passphrasePlaceholder')" class="ui-input password-input" />
          <button type="button" class="btn-toggle-password" @click="emit('update:showPassword', !showPassword)" :title="showPassword ? t('connectionForm.hidePassword') : t('connectionForm.showPassword')">
            <AppIcon :name="showPassword ? 'eye-off' : 'eye'" size="md" />
          </button>
        </div>
      </div>
    </div>

    <div class="form-grid-2">
      <div class="form-row">
        <label class="label">{{ t('connectionForm.group') }}</label>
        <select v-model="form.group" class="ui-select">
          <option v-for="g in groups" :key="g.id" :value="g.id">
            {{ g.name }}{{ g.isDefault ? ` (${t('groups.defaultGroup')})` : '' }}
          </option>
        </select>
      </div>
      <div class="form-row">
        <label class="label">{{ t('connectionForm.colorTag') }}</label>
        <div class="color-tag-options">
          <button
            v-for="tag in CONNECTION_COLOR_TAGS"
            :key="tag.id || 'none'"
            type="button"
            class="color-tag-btn"
            :class="{ active: form.colorTag === tag.id }"
            :title="tag.label"
            @click="form.colorTag = tag.id"
          >
            <span class="color-tag-swatch" :style="{ background: tag.color }"></span>
          </button>
        </div>
      </div>
    </div>

    <div class="form-row">
      <label class="label">{{ t('connectionForm.note') }}</label>
      <input v-model="form.note" class="ui-input" :placeholder="t('connectionForm.notePlaceholder')" maxlength="200" />
    </div>
  </div>
</template>
