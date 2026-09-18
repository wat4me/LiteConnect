<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ConnectionFormModel } from './connectionFormTypes'

defineProps<{
  form: ConnectionFormModel
  jumpAuthType: 'password' | 'key'
  jumpPrivateKeyFileName: string
}>()

const emit = defineEmits<{
  (e: 'switch-jump-auth', type: 'password' | 'key'): void
  (e: 'select-jump-key'): void
  (e: 'clear-jump-key'): void
}>()

const { t } = useI18n()
</script>

<template>
  <div class="form-section">
    <div class="form-row panel">
      <div class="panel-head">
        <span class="panel-title">{{ t('connectionForm.jumpTitle') }}</span>
        <span class="panel-hint">{{ t('connectionForm.jumpHint') }}</span>
      </div>
      <div class="x11-options">
        <div class="x11-field">
          <label class="label">{{ t('connectionForm.jumpHost') }}</label>
          <input v-model="form.jumpHost" class="ui-input" placeholder="bastion.example.com" />
        </div>
        <div class="x11-field x11-display-field">
          <label class="label">{{ t('connectionForm.port') }}</label>
          <input v-model.number="form.jumpPort" type="number" min="1" max="65535" class="ui-input" />
        </div>
      </div>
      <div v-if="form.jumpHost" class="x11-options">
        <div class="x11-field">
          <label class="label">{{ t('connectionForm.jumpUser') }}</label>
          <input v-model="form.jumpUsername" class="ui-input" :placeholder="t('connectionForm.jumpUserPlaceholder')" />
        </div>
        <div class="x11-field">
          <label class="label">{{ t('connectionForm.jumpAuthType') }}</label>
          <div class="auth-tabs">
            <button type="button" class="auth-tab" :class="{ active: jumpAuthType === 'password' }" @click="emit('switch-jump-auth', 'password')">{{ t('connectionForm.password') }}</button>
            <button type="button" class="auth-tab" :class="{ active: jumpAuthType === 'key' }" @click="emit('switch-jump-auth', 'key')">{{ t('connectionForm.key') }}</button>
          </div>
        </div>
      </div>
      <div v-if="form.jumpHost && jumpAuthType === 'password'" class="x11-options">
        <div class="x11-field">
          <label class="label">{{ t('connectionForm.jumpPassword') }}</label>
          <input v-model="form.jumpPassword" type="password" class="ui-input" :placeholder="t('connectionForm.jumpPasswordPlaceholder')" />
        </div>
      </div>
      <div v-if="form.jumpHost && jumpAuthType === 'key'" class="form-row">
        <label class="label">{{ t('connectionForm.jumpPrivateKey') }}</label>
        <div class="key-file-row">
          <button type="button" class="ui-btn" @click="emit('select-jump-key')">{{ t('connectionForm.selectPrivateKey') }}</button>
          <span v-if="jumpPrivateKeyFileName" class="key-file-name">{{ jumpPrivateKeyFileName }}</span>
          <button v-if="jumpPrivateKeyFileName" type="button" class="btn-icon-remove" @click="emit('clear-jump-key')">{{ t('connectionForm.clearPrivateKey') }}</button>
        </div>
      </div>
    </div>

    <div class="form-row panel">
      <div class="panel-head">
        <span class="panel-title">{{ t('connectionForm.localForwardTitle') }}</span>
        <span class="panel-hint">{{ t('connectionForm.localForwardHint') }}</span>
      </div>
      <div
        v-for="(fwd, idx) in form.localForwards"
        :key="idx"
        class="forward-row"
      >
        <div class="x11-field x11-display-field">
          <label class="label">{{ t('connectionForm.localPort') }}</label>
          <input v-model.number="fwd.localPort" type="number" min="1" max="65535" class="ui-input" />
        </div>
        <div class="x11-field">
          <label class="label">{{ t('connectionForm.remoteHost') }}</label>
          <input v-model="fwd.remoteHost" class="ui-input" placeholder="127.0.0.1" />
        </div>
        <div class="x11-field x11-display-field">
          <label class="label">{{ t('connectionForm.remotePort') }}</label>
          <input v-model.number="fwd.remotePort" type="number" min="1" max="65535" class="ui-input" />
        </div>
        <button type="button" class="btn-icon-remove" :title="t('common.delete')" @click="form.localForwards.splice(idx, 1)">{{ t('connectionForm.removeShort') }}</button>
      </div>
      <button
        type="button"
        class="btn-add-row"
        @click="form.localForwards.push({ localPort: 0, remoteHost: '127.0.0.1', remotePort: 0 })"
      >
        {{ t('connectionForm.addForward') }}
      </button>
    </div>

    <div class="form-row panel">
      <div class="panel-head">
        <span class="panel-title">{{ t('connectionForm.remoteForwardTitle') }}</span>
        <span class="panel-hint">{{ t('connectionForm.remoteForwardHint') }}</span>
      </div>
      <div v-for="(fwd, idx) in form.remoteForwards" :key="'rf' + idx" class="forward-row">
        <div class="x11-field x11-display-field">
          <label class="label">{{ t('connectionForm.remotePort') }}</label>
          <input v-model.number="fwd.remotePort" type="number" min="1" max="65535" class="ui-input" />
        </div>
        <div class="x11-field">
          <label class="label">{{ t('connectionForm.localHost') }}</label>
          <input v-model="fwd.localHost" class="ui-input" placeholder="127.0.0.1" />
        </div>
        <div class="x11-field x11-display-field">
          <label class="label">{{ t('connectionForm.localPort') }}</label>
          <input v-model.number="fwd.localPort" type="number" min="1" max="65535" class="ui-input" />
        </div>
        <button type="button" class="btn-icon-remove" :title="t('common.delete')" @click="form.remoteForwards.splice(idx, 1)">{{ t('connectionForm.removeShort') }}</button>
      </div>
      <button
        type="button"
        class="btn-add-row"
        @click="form.remoteForwards.push({ remoteHost: '127.0.0.1', remotePort: 0, localHost: '127.0.0.1', localPort: 0 })"
      >
        {{ t('connectionForm.addRemoteForward') }}
      </button>
    </div>

    <div class="form-row panel">
      <div class="panel-head">
        <span class="panel-title">{{ t('connectionForm.dynamicForwardTitle') }}</span>
        <span class="panel-hint">{{ t('connectionForm.dynamicForwardHint') }}</span>
      </div>
      <div v-for="(fwd, idx) in form.dynamicForwards" :key="'df' + idx" class="forward-row">
        <div class="x11-field x11-display-field">
          <label class="label">{{ t('connectionForm.socksPort') }}</label>
          <input v-model.number="fwd.localPort" type="number" min="1" max="65535" class="ui-input" />
        </div>
        <button type="button" class="btn-icon-remove" :title="t('common.delete')" @click="form.dynamicForwards.splice(idx, 1)">{{ t('connectionForm.removeShort') }}</button>
      </div>
      <button
        type="button"
        class="btn-add-row"
        @click="form.dynamicForwards.push({ localPort: 1080 })"
      >
        {{ t('connectionForm.addSocksForward') }}
      </button>
    </div>

    <div class="form-row panel">
      <label class="checkbox-row">
        <input v-model="form.x11Forwarding" type="checkbox" />
        <span>{{ t('connectionForm.graphicalForwarding') }}</span>
      </label>
      <div class="hint-text">
        {{ t('connectionForm.graphicalHint') }}
      </div>
      <div v-if="form.x11Forwarding" class="x11-options">
        <div class="x11-field">
          <label class="label">{{ t('connectionForm.displayHost') }}</label>
          <input v-model="form.x11Host" placeholder="127.0.0.1" class="ui-input" />
        </div>
        <div class="x11-field x11-display-field">
          <label class="label">{{ t('connectionForm.displayNumber') }}</label>
          <input v-model.number="form.x11Display" type="number" min="0" max="99" placeholder="0" class="ui-input" />
        </div>
      </div>
      <div v-if="form.x11Forwarding" class="hint-text">
        {{ t('connectionForm.willConnect', {
          host: form.x11Host || '127.0.0.1',
          port: 6000 + (Number.isInteger(form.x11Display) ? form.x11Display : 0),
        }) }}
      </div>
    </div>
  </div>
</template>
