<template>
    <div class="card mb-2" :class="{ 'border-danger': group.status === 'regressed', 'opacity-75': group.status === 'resolved' }">
        <div class="card-header d-flex gap-2 align-items-start" role="button" @click="toggle">
            <span class="badge bg-dark fs-6">{{ group.count }}</span>
            <div class="flex-grow-1">
                <div class="fw-bold text-break">{{ firstLine }}</div>
                <div class="small text-muted">
                    <span v-if="showGame" class="badge bg-secondary me-1">{{ group.game }}</span>
                    <span v-if="group.status === 'regressed'" class="badge bg-danger me-1">regressed</span>
                    <span v-if="group.status === 'resolved'" class="badge bg-success me-1">resolved</span>
                    {{ group.script }} &middot;
                    <span v-if="group.players">{{ group.players }} player(s) &middot;</span>
                    last {{ new Date(group.lastSeen).toLocaleString() }} &middot;
                    first {{ new Date(group.firstSeen).toLocaleDateString() }} &middot;
                    {{ group.versions.join(', ') || 'no version' }}
                    <span v-if="group.platforms.length">&middot; {{ group.platforms.join(', ') }}</span>
                </div>
            </div>
            <button class="btn btn-sm" :class="group.status === 'resolved' ? 'btn-outline-secondary' : 'btn-outline-success'"
                    @click.stop="resolve(group.status !== 'resolved')">
                {{ group.status === 'resolved' ? 'Reopen' : 'Resolve' }}
            </button>
            <button class="btn btn-sm btn-outline-danger" @click.stop="deleteGroup">Delete</button>
        </div>
        <div v-if="!collapsed" class="card-body">
            <p v-if="!crashes" class="text-muted">Loading...</p>
            <div v-for="crash in crashes || []" :key="crash._id">
                <crash-card :crash="crash" @crashDeleted="removeCrash" />
            </div>
        </div>
    </div>
</template>

<script>
import CrashCard from './CrashCard.vue';

export default {
    components: { CrashCard },
    props: {
        group: { type: Object, required: true },
        showGame: { type: Boolean, default: true },
    },
    emits: ['changed'],
    data() {
        return { collapsed: true, crashes: null };
    },
    computed: {
        firstLine() {
            return String(this.group.message || '').split('\n')[0];
        },
    },
    methods: {
        toggle() {
            this.collapsed = !this.collapsed;
            // Occurrences load when the group is opened, not with the list: the list is every
            // group of every game and most are never opened.
            if (!this.collapsed && !this.crashes) {
                this.$http.get('/api/crash', { params: { fingerprint: this.group.fingerprint, limit: 50 } })
                    .then((r) => { this.crashes = r.data; }, (e) => console.log(e));
            }
        },
        resolve(resolved) {
            this.$http.post(`/api/crash/groups/${this.group.fingerprint}/resolve`, { resolved })
                .then(() => this.$emit('changed'));
        },
        deleteGroup() {
            if (confirm(`Delete all ${this.group.count} crash(es) in this group?`)) {
                this.$http.delete(`/api/crash/groups/${this.group.fingerprint}`).then(() => this.$emit('changed'));
            }
        },
        removeCrash(crash) {
            const idx = this.crashes.findIndex((c) => c._id === crash._id);
            if (idx !== -1) this.crashes.splice(idx, 1);
            this.$emit('changed');
        },
    },
}
</script>
