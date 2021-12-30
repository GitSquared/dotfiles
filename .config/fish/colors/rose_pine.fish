	set -l base 191724
	set -l surface 1f1d2e
	set -l overlay 26233a
	set -l inactive 555169
	set -l subtle 6e6a86
	set -l text e0def4
	set -l love eb6f92
	set -l gold f6c177
	set -l rose ebbcba
	set -l pine 31748f
	set -l foam 9ccfd8
	set -l iris c4a7e7

	set -U fish_color_normal normal
	set -U fish_color_command $iris
	set -U fish_color_quote $gold
	set -U fish_color_redirection $pine
	set -U fish_color_end $iris
	set -U fish_color_error $love
	set -U fish_color_param $text
	set -U fish_color_comment $subtle
	set -U fish_color_match --background=brblue
	set -U fish_color_selection white --bold --background=brblack
	set -U fish_color_search_match bryellow --background=brblack
	set -U fish_color_history_current --bold
	set -U fish_color_operator $foam
	set -U fish_color_escape $foam
	set -U fish_color_cwd green
	set -U fish_color_cwd_root red
	set -U fish_color_valid_path --underline
	set -U fish_color_autosuggestion $subtle
	set -U fish_color_user brgreen
	set -U fish_color_host normal
	set -U fish_color_cancel -r
	set -U fish_pager_color_completion normal
	set -U fish_pager_color_description $rose yellow
	set -U fish_pager_color_prefix white --bold --underline
	set -U fish_pager_color_progress brwhite --background=cyan
