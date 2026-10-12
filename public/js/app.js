let dbSyncQueue = [];
let userInfo = { email: "loading...", isAdmin: false };
let currentLocation = JSON.parse(localStorage.getItem('journalLoc')) || { name: 'Irvine, CA', lat: 33.6846, lon: -117.8265, tz: 'America/Los_Angeles' };
let activeOutcome = 'pending';
let activeObservedNadi = 'ida';
let currentEntriesData = [];
let editingEntryId = null;
let currentCategories = [];

const openDB = () => new Promise((resolve) => {
    let req = indexedDB.open('swaraJournalOffline', 1);
    req.onupgradeneeded = (e) => {
        let db = e.target.result;
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
});

async function saveOffline(entry) {
    const db = await openDB();
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').put(entry);
    updateSyncIndicator();
}

async function flushOfflineQueue() {
    if (!navigator.onLine) return;
    const db = await openDB();
    const tx = db.transaction('queue', 'readonly');
    const store = tx.objectStore('queue');
    const all = await new Promise(res => { const r = store.getAll(); r.onsuccess = () => res(r.result); });

    if (all && all.length > 0) {
        try {
            const res = await fetch('/api/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(all) });
            if (res.ok) {
                const delTx = db.transaction('queue', 'readwrite');
                delTx.objectStore('queue').clear();
                updateSyncIndicator(0);
                loadHistory();
            }
        } catch (e) { }
    }
}

async function updateSyncIndicator(count = null) {
    const el = document.getElementById('syncIndicator');
    if (count === null) {
        const db = await openDB();
        const tx = db.transaction('queue', 'readonly');
        count = await new Promise(res => { const r = tx.objectStore('queue').count(); r.onsuccess = () => res(r.result); });
    }
    el.innerText = count > 0 ? `⚠️ ${count} un-synced entries (saved offline)` : `● Fully Synced to Server`;
    el.style.color = count > 0 ? "var(--pingala)" : "var(--purna)";
}

window.addEventListener('online', flushOfflineQueue);

const fpTime = flatpickr("#activityTimeInput", { enableTime: true, dateFormat: "Y-m-d H:i", defaultDate: new Date(), disableMobile: true });

document.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { });

    try {
        const r = await fetch('/api/user-info', { cache: 'no-store' });
        userInfo = await r.json();
        document.getElementById('userEmailDisplay').innerText = userInfo.email;
        if (userInfo.isAdmin) document.getElementById('adminScopeContainer').style.display = 'block';
    } catch (e) { }

    await loadCategories();
    loadHistory();
    updateSyncIndicator();
    setupNavigation();
    document.getElementById('locDisplay').innerText = currentLocation.name;
});

function setupNavigation() {
    document.querySelectorAll('.bottom-nav button').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelectorAll('.bottom-nav button').forEach(x => x.classList.remove('active'));
            document.querySelectorAll('.tab-page').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            document.getElementById(b.dataset.target).classList.add('active');
            if (b.dataset.target === 'historyTab') loadHistory();
            if (b.dataset.target === 'analyticsTab') loadAnalytics();
        });
    });
}

async function loadCategories() {
    try {
        const res = await fetch('/api/categories', { cache: 'no-store' });
        currentCategories = await res.json();
        
        const sel = document.getElementById('categorySelect');
        sel.innerHTML = currentCategories.map(c => `<option value="${c}">${c}</option>`).join('');
        
        const anaSel = document.getElementById('analyticsCategorySelect');
        if (anaSel) {
             anaSel.innerHTML = `<option value="all">All Categories</option>` + currentCategories.map(c => `<option value="${c}">${c}</option>`).join('');
        }
    } catch (e) { }
}

document.getElementById('btnAddCategory').addEventListener('click', async () => {
    const val = prompt("Enter new activity category name:");
    if (val && val.trim()) {
        await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: val.trim() }) });
        loadCategories();
    }
});

document.getElementById('btnDelCategory').addEventListener('click', async () => {
    const sel = document.getElementById('categorySelect');
    if (!sel.value) return;
    if (confirm(`Permanently delete "${sel.value}" from the dropdown? (Past records keep their data)`)) {
        try {
            await fetch(`/api/categories/${encodeURIComponent(sel.value)}`, { method: 'DELETE' });
            loadCategories();
        } catch(e) { alert("Error deleting category."); }
    }
});

const locSearch = document.getElementById('locSearch');
const locDropdown = document.getElementById('locDropdown');
let locTimeoutId;

locSearch.addEventListener('input', function() {
    clearTimeout(locTimeoutId);
    const val = this.value.trim();
    if(!val) { locDropdown.style.display = 'none'; return; }
    
    locTimeoutId = setTimeout(async () => {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val)}&format=json&limit=5`);
            const data = await res.json();
            locDropdown.innerHTML = '';
            
            if(data.length > 0) {
                data.forEach(place => {
                    const div = document.createElement('div');
                    div.innerText = place.display_name;
                    div.onclick = async () => {
                        locDropdown.style.display = 'none';
                        locSearch.value = '';
                        document.getElementById('locDisplay').innerText = 'Fetching TZ...';
                        
                        const tzRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current_weather=true&timezone=auto`);
                        const tzData = await tzRes.json();
                        
                        currentLocation = { name: place.display_name.split(',')[0], lat: parseFloat(place.lat), lon: parseFloat(place.lon), tz: tzData.timezone || 'UTC' };
                        localStorage.setItem('journalLoc', JSON.stringify(currentLocation));
                        document.getElementById('locDisplay').innerText = currentLocation.name;
                    };
                    locDropdown.appendChild(div);
                });
                locDropdown.style.display = 'block';
            } else { locDropdown.style.display = 'none'; }
        } catch(e) {}
    }, 600);
});

document.addEventListener('click', function(e) { if (locSearch && !locSearch.contains(e.target) && !locDropdown.contains(e.target)) locDropdown.style.display = 'none'; });

document.getElementById('btnGpsLocate').addEventListener('click', () => {
    if (!navigator.geolocation) return alert("Geolocation not supported.");
    document.getElementById('locDisplay').innerText = 'Getting GPS...';
    
    navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
            const geoData = await geoRes.json();
            let city = geoData.address.city || geoData.address.town || geoData.address.county || "GPS Location";
            const tzRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&timezone=auto`);
            const tzData = await tzRes.json();
            
            currentLocation = { name: city, lat: latitude, lon: longitude, tz: tzData.timezone || 'UTC' };
            localStorage.setItem('journalLoc', JSON.stringify(currentLocation));
            document.getElementById('locDisplay').innerText = currentLocation.name;
        } catch (e) {
            alert("Error fetching location data.");
            document.getElementById('locDisplay').innerText = currentLocation.name;
        }
    }, (err) => {
        alert("GPS access denied or unavailable.");
        document.getElementById('locDisplay').innerText = currentLocation.name;
    });
});

document.querySelectorAll('#outcomeGroup button').forEach(b => {
    b.addEventListener('click', () => { document.querySelectorAll('#outcomeGroup button').forEach(x => x.classList.remove('active')); b.classList.add('active'); activeOutcome = b.dataset.val; });
});

document.querySelectorAll('#nadiGroup button').forEach(b => {
    b.addEventListener('click', () => { document.querySelectorAll('#nadiGroup button').forEach(x => x.classList.remove('active')); b.classList.add('active'); activeObservedNadi = b.dataset.val; });
});

document.getElementById('entryForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const actDate = fpTime.selectedDates[0] || new Date();
    const engine = document.getElementById('engineSelect').value;
    const calc = getSwaraState(actDate, currentLocation.lat, currentLocation.lon, currentLocation.tz, engine);

    const observedTattva = document.getElementById('tattvaSelect').value;
    const travelDir = document.getElementById('travelDirSelect').value;
    const faceDir = document.getElementById('facingDirSelect').value;
    const category = document.getElementById('categorySelect').value;
    const notes = document.getElementById('notesInput').value;

    const payload = {
        id: editingEntryId || ('entry_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)),
        user_email: userInfo.email, activity_time: actDate.getTime(), recorded_at: Date.now(), category, engine, location: currentLocation,
        user_input: { observed_nadi: activeObservedNadi, observed_tattva: observedTattva, travel_direction: travelDir, facing_direction: faceDir, outcome: activeOutcome, notes },
        calculated_blueprint: calc,
        divergence: {
            nadi_match: activeObservedNadi === calc.nadi,
            tattva_match: observedTattva.toLowerCase() === calc.tattva.toLowerCase(),
            travel_aligned: calc.soola.clear_dirs.includes(travelDir),
            facing_dir: faceDir 
        },
        outcome: activeOutcome, notes
    };

    try {
        const res = await fetch('/api/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error("Offline save");
    } catch (err) { await saveOffline(payload); }

    document.getElementById('entryForm').reset(); fpTime.setDate(new Date()); 
    activeOutcome = 'pending'; document.querySelectorAll('#outcomeGroup button').forEach(b => b.classList.remove('active')); document.querySelector('#outcomeGroup button[data-val="pending"]').classList.add('active');
    activeObservedNadi = 'ida'; document.querySelectorAll('#nadiGroup button').forEach(b => b.classList.remove('active')); document.querySelector('#nadiGroup button[data-val="ida"]').classList.add('active');
    editingEntryId = null; document.querySelector('#entryForm button[type="submit"]').innerText = "Save Journal Entry";
    
    alert("Record Saved Successfully!");
    loadHistory();
});

async function loadHistory() {
    const list = document.getElementById('historyList');
    list.innerHTML = `<div style="text-align:center; padding:10px;">Loading history...</div>`;

    try {
        const res = await fetch('/api/entries', { cache: 'no-store' });
        const data = await res.json();
        currentEntriesData = data; 

        if (!data.length) { list.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:10px;">No entries recorded yet.</div>`; return; }

        list.innerHTML = data.map(item => {
            const d = new Date(item.activity_time);
            const timeStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            let outcomeColor = 'var(--text-muted)';
            if (item.outcome === 'success') outcomeColor = 'var(--purna)';
            if (item.outcome === 'failure') outcomeColor = 'var(--sunya)';
            if (item.outcome === 'pending') outcomeColor = '#d29922';

            return `
            <div class="history-item">
                <div class="header" onclick="toggleDetails('${item.id}')">
                    <div>
                        <strong style="color:var(--text-main);">${item.category}</strong>
                        <div style="font-size:0.75rem; color:var(--text-muted);">${timeStr}</div>
                    </div>
                    <div style="text-align:right;">
                        <select class="edit-outcome-select" style="color:${outcomeColor}; font-weight:bold; border-color:${outcomeColor};" onchange="updateRecordOutcome('${item.id}', this.value)" onclick="event.stopPropagation()">
                            <option value="pending" ${item.outcome === 'pending' ? 'selected' : ''}>PENDING</option>
                            <option value="success" ${item.outcome === 'success' ? 'selected' : ''}>SUCCESS</option>
                            <option value="failure" ${item.outcome === 'failure' ? 'selected' : ''}>FAILURE</option>
                        </select>
                        <div style="font-size:0.75rem; color:var(--accent); margin-top:4px;">Score: ${item.calculated_blueprint.resonance_score}/5</div>
                    </div>
                </div>
                <div class="details" id="details_${item.id}">
                    <div style="background:var(--bg-card); padding:8px; border:1px solid var(--border); border-radius:4px; margin-bottom:8px; font-size:0.8rem;">
                        <strong>Vedic Snapshot:</strong><br>
                        • ${item.calculated_blueprint.vaara || 'Unknown'} | Hora: <strong>${item.calculated_blueprint.hora || 'Unknown'}</strong><br>
                        • ${item.calculated_blueprint.yaamam_desc || 'Unknown Yaamam'}<br>
                        • ${item.calculated_blueprint.tithi || 'Unknown'}, ${item.calculated_blueprint.paksha || 'Unknown'} Paksha<br>
                        • ${item.calculated_blueprint.lunar_month || 'Unknown'} Masa (Lunar) / ${item.calculated_blueprint.solar_month || 'Unknown'} Masa (Solar) / ${item.calculated_blueprint.ayana || 'Unknown'}
                    </div>
                    <p><strong>Observed:</strong> ${item.user_input.observed_nadi.toUpperCase()} | ${item.user_input.observed_tattva}</p>
                    <p><strong>Calculated:</strong> ${item.calculated_blueprint.nadi.toUpperCase()} | ${item.calculated_blueprint.tattva} (${item.calculated_blueprint.tattva_status})</p>
                    <p><strong>Alignment:</strong> Nadi: ${item.divergence.nadi_match ? '✅' : '❌'} | Tattva: ${item.divergence.tattva_match ? '✅' : '❌'}</p>
                    <p><strong>Travel:</strong> Traveled ${item.user_input.travel_direction} (${item.divergence.travel_aligned === undefined ? '⚠️️ Needs Update' : (item.divergence.travel_aligned ? '✅ Cleared' : '❌ Blocked')})</p>
                    <p><strong>Permitted Travel:</strong> ${item.calculated_blueprint.soola ? item.calculated_blueprint.soola.clear_dirs.join(', ') : 'Unknown'}</p>
                    ${item.notes ? `<p style="margin-top:4px;"><strong>Notes:</strong> ${item.notes}</p>` : ''}
                    
                    <div style="display:flex; gap:10px; margin-top:12px; border-top:1px solid var(--border); padding-top:10px;">
                        <button class="btn btn-sm" style="flex:1; background:var(--ida); border:none;" onclick="event.stopPropagation(); loadEntryForEdit('${item.id}')">✏️ Edit Details</button>
                        <button class="btn btn-sm" style="flex:1; background:var(--sunya); border:none;" onclick="event.stopPropagation(); deleteEntry('${item.id}')">🗑️ Delete</button>
                    </div>
                </div>
            </div>`;
        }).join('');
    } catch (e) { list.innerHTML = `<div style="color:var(--sunya); text-align:center;">Failed to load entries.</div>`; }
}

window.toggleDetails = function (id) { const el = document.getElementById(`details_${id}`); el.style.display = el.style.display === 'block' ? 'none' : 'block'; };

window.updateRecordOutcome = async function (id, newOutcome) {
    try {
        await fetch(`/api/entries/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome: newOutcome }) });
        loadHistory(); loadAnalytics();
    } catch (e) { alert("Could not update outcome. Ensure you are online."); }
};

window.deleteEntry = async function(id) {
    if (!confirm("Are you sure you want to permanently delete this entry?")) return;
    try {
        await fetch(`/api/entries/${id}`, { method: 'DELETE' });
        loadHistory(); loadAnalytics();
    } catch (e) { alert("Failed to delete. Ensure you are online."); }
};

window.loadEntryForEdit = function(id) {
    const item = currentEntriesData.find(x => x.id === id); if (!item) return;
    editingEntryId = item.id; 
    fpTime.setDate(new Date(item.activity_time));
    document.getElementById('engineSelect').value = item.engine;
    document.getElementById('categorySelect').value = item.category;
    document.getElementById('tattvaSelect').value = item.user_input.observed_tattva;
    document.getElementById('travelDirSelect').value = item.user_input.travel_direction;
    document.getElementById('facingDirSelect').value = item.user_input.facing_direction;
    document.getElementById('notesInput').value = item.notes || '';
    
    document.querySelectorAll('#nadiGroup button').forEach(b => b.classList.remove('active'));
    document.querySelector(`#nadiGroup button[data-val="${item.user_input.observed_nadi}"]`).classList.add('active');
    activeObservedNadi = item.user_input.observed_nadi;
    document.querySelectorAll('#outcomeGroup button').forEach(b => b.classList.remove('active'));
    document.querySelector(`#outcomeGroup button[data-val="${item.outcome}"]`).classList.add('active');
    activeOutcome = item.outcome;

    document.querySelector('[data-target="recordTab"]').click();
    document.querySelector('#entryForm button[type="submit"]').innerText = "Update Journal Entry";
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

async function loadAnalytics() {
    const scopeSel = document.getElementById('analyticsScopeSelect');
    const catSel = document.getElementById('analyticsCategorySelect');
    
    const scope = scopeSel ? scopeSel.value : 'user';
    const cat = catSel ? catSel.value : 'all';
    
    try {
        const res = await fetch(`/api/analytics?scope=${scope}&category=${encodeURIComponent(cat)}`, { cache: 'no-store' });
        const data = await res.json();

        document.getElementById('anaTotal').innerText = data.total;
        const wins = (data.outcomes.success || 0);
        const losses = (data.outcomes.failure || 0);
        const resolved = wins + losses;
        
        const winRate = resolved > 0 ? ((wins / resolved) * 100).toFixed(1) : "0.0";
        document.getElementById('anaWinRate').innerText = `${winRate}%`;
        document.getElementById('anaWinRate').style.color = winRate >= 50 ? "var(--purna)" : "var(--sunya)";
        
        document.getElementById('anaNadiRate').innerText = `${data.correlations.nadi || "0.0"}%`;
        document.getElementById('anaTattvaRate').innerText = `${data.correlations.tattva || "0.0"}%`;
        document.getElementById('anaTravelRate').innerText = `${data.correlations.travel || "0.0"}%`;
        
        const triggersContainer = document.getElementById('triggersList');
        if (data.triggers && data.triggers.length > 0) {
            triggersContainer.innerHTML = data.triggers.map(t => 
                `<div class="trigger-item">
                    <strong>${t.winRate}% Win Rate</strong> (${t.wins}/${t.total} matches)<br>
                    ${t.combination}
                </div>`
            ).join('');
        } else {
            triggersContainer.innerHTML = `<div style="color:var(--text-muted); font-size:0.8rem;">Insufficient completed data for pattern matching. Log more Success/Failure outcomes.</div>`;
        }

        const trapsContainer = document.getElementById('trapsList');
        if (data.traps && data.traps.length > 0) {
            trapsContainer.innerHTML = data.traps.map(t => 
                `<div class="trap-item">
                    <strong>${t.lossRate}% Failure Rate</strong> (${t.losses}/${t.total} matches)<br>
                    ${t.combination}
                </div>`
            ).join('');
        } else {
            trapsContainer.innerHTML = `<div style="color:var(--text-muted); font-size:0.8rem;">Insufficient completed data for pattern matching. Log more Success/Failure outcomes.</div>`;
        }

    } catch(e) {}
}

const themeBtn = document.getElementById('themeToggleBtn');
let currentTheme = localStorage.getItem('journalTheme') || 'dark';
document.documentElement.setAttribute('data-theme', currentTheme);
themeBtn.innerText = currentTheme === 'dark' ? '☀' : '🌙';

themeBtn.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('journalTheme', currentTheme);
    themeBtn.innerText = currentTheme === 'dark' ? '☀️' : '🌙';
});

document.getElementById('logoutBtn').addEventListener('click', () => { window.location.href = '/cdn-cgi/access/logout'; });