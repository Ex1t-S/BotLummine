const shell = document.getElementById('adminShell');
const toggle = document.getElementById('sidebarToggle');

if (shell && toggle) {
	toggle.addEventListener('click', () => {
		shell.classList.toggle('sidebar-collapsed');
	});
}